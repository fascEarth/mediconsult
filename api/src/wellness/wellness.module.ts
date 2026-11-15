import { Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService, CryptoService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

/** Each vital type has its own validated reading shape. Readings are PHI and stored encrypted. */
export const VitalDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('BP'), recordedAt: z.string().datetime().optional(), value: z.object({ systolic: z.number().int().min(60).max(260), diastolic: z.number().int().min(30).max(160) }) }),
  z.object({ type: z.literal('HR'), recordedAt: z.string().datetime().optional(), value: z.object({ bpm: z.number().int().min(25).max(250) }) }),
  z.object({ type: z.literal('WEIGHT'), recordedAt: z.string().datetime().optional(), value: z.object({ kg: z.number().min(1).max(400) }) }),
  z.object({ type: z.literal('GLUCOSE'), recordedAt: z.string().datetime().optional(), value: z.object({ mgdl: z.number().min(20).max(700), context: z.enum(['fasting', 'post-meal', 'random']) }) }),
  z.object({ type: z.literal('TEMP'), recordedAt: z.string().datetime().optional(), value: z.object({ celsius: z.number().min(30).max(45) }) }),
  z.object({ type: z.literal('SPO2'), recordedAt: z.string().datetime().optional(), value: z.object({ percent: z.number().int().min(50).max(100) }) }),
]);
export type VitalInput = z.infer<typeof VitalDto>;
export const VITAL_TYPES = ['BP', 'HR', 'WEIGHT', 'GLUCOSE', 'TEMP', 'SPO2'] as const;

/** Parses free-text durations like "5 days", "2 weeks", "1 month", "10". Returns null for ongoing/unknown. */
export function durationDays(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/(ongoing|continue|long[- ]term|lifelong|sos|as needed)/.test(t)) return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'd';
  if (unit.startsWith('w')) return Math.round(n * 7);
  if (unit.startsWith('m')) return Math.round(n * 30);
  return Math.round(n);
}

/** Flags readings outside common adult reference ranges (informational only, not a diagnosis). */
export function vitalFlag(type: string, v: Record<string, number | string>): 'high' | 'low' | null {
  const n = (k: string) => Number(v[k]);
  switch (type) {
    case 'BP': return n('systolic') >= 140 || n('diastolic') >= 90 ? 'high' : n('systolic') < 90 || n('diastolic') < 60 ? 'low' : null;
    case 'HR': return n('bpm') > 100 ? 'high' : n('bpm') < 50 ? 'low' : null;
    case 'GLUCOSE': {
      const hi = v['context'] === 'fasting' ? 126 : 200;
      return n('mgdl') >= hi ? 'high' : n('mgdl') < 70 ? 'low' : null;
    }
    case 'TEMP': return n('celsius') >= 38 ? 'high' : n('celsius') < 35 ? 'low' : null;
    case 'SPO2': return n('percent') < 94 ? 'low' : null;
    default: return null;
  }
}

interface RxItem { medicine: string; dosage: string; frequency: string; duration: string; instructions?: string }

@Injectable()
export class WellnessService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  async vitals(patientId: string, days = 180, type?: string) {
    const rows = await this.prisma.vital.findMany({
      where: { patientId, recordedAt: { gte: new Date(Date.now() - days * 86_400_000) }, ...(type ? { type } : {}) },
      orderBy: { recordedAt: 'asc' },
      take: 1000,
    });
    return rows.map((r) => {
      const value = this.crypto.decryptJson<Record<string, number | string>>(r.valueEnc);
      return { id: r.id, type: r.type, value, recordedAt: r.recordedAt, flag: vitalFlag(r.type, value) };
    });
  }

  async myVitals(user: AuthUser, days?: number, type?: string) {
    const out = await this.vitals(user.id, days, type);
    await this.audit.log(user, 'vitals.read', 'patient', user.id);
    return out;
  }

  async addVital(user: AuthUser, input: VitalInput) {
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    if (recordedAt.getTime() > Date.now() + 5 * 60_000) throw new ForbiddenException('Readings cannot be in the future');
    const v = await this.prisma.vital.create({ data: { patientId: user.id, type: input.type, valueEnc: this.crypto.encryptJson(input.value), recordedAt } });
    await this.audit.log(user, 'vitals.write', 'vital', v.id, { type: input.type });
    return { id: v.id, type: v.type, value: input.value, recordedAt: v.recordedAt, flag: vitalFlag(v.type, input.value as Record<string, number | string>) };
  }

  async deleteVital(user: AuthUser, id: string) {
    const v = await this.prisma.vital.findUnique({ where: { id } });
    if (!v || v.patientId !== user.id) throw new NotFoundException();
    await this.prisma.vital.delete({ where: { id } });
    await this.audit.log(user, 'vitals.delete', 'vital', id);
    return { ok: true };
  }

  /** Medicines from the patient's prescriptions, marked active while within their duration. */
  async medications(user: AuthUser) {
    const rows = await this.prisma.prescription.findMany({
      where: { appointment: { patientId: user.id } },
      include: { appointment: { include: { doctor: { include: { user: true } } } } },
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });
    const now = Date.now();
    const meds = rows.flatMap((p) => {
      const data = this.crypto.decryptJson<{ diagnosis?: string; items?: RxItem[] }>(p.dataEnc);
      return (data.items ?? []).map((it) => {
        const days = durationDays(it.duration);
        const endsAt = days === null ? null : new Date(p.issuedAt.getTime() + days * 86_400_000);
        return {
          medicine: it.medicine, dosage: it.dosage, frequency: it.frequency, duration: it.duration, instructions: it.instructions,
          diagnosis: data.diagnosis, issuedAt: p.issuedAt, endsAt, active: endsAt === null ? true : endsAt.getTime() > now,
          appointmentId: p.appointmentId, doctor: `Dr. ${p.appointment.doctor.user.firstName} ${p.appointment.doctor.user.lastName}`,
        };
      });
    });
    await this.audit.log(user, 'medications.read', 'patient', user.id);
    return meds;
  }

  async summary(user: AuthUser) {
    const [vitals, meds, next, completed, records] = await Promise.all([
      this.vitals(user.id, 365),
      this.medications(user),
      this.prisma.appointment.findFirst({
        where: { patientId: user.id, status: 'CONFIRMED', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' },
        include: { doctor: { include: { user: true } } },
      }),
      this.prisma.appointment.count({ where: { patientId: user.id, status: 'COMPLETED' } }),
      this.prisma.medicalRecord.count({ where: { patientId: user.id } }),
    ]);
    const latest: Record<string, unknown> = {};
    for (const v of vitals) latest[v.type] = v; // ascending order → last wins
    return {
      latest,
      activeMedications: meds.filter((m) => m.active).length,
      consultations: completed,
      records,
      next: next ? { id: next.id, startsAt: next.startsAt, doctor: `Dr. ${next.doctor.user.firstName} ${next.doctor.user.lastName}`, specialty: next.doctor.specialty } : null,
    };
  }

  /** Treating doctor sees the patient's vitals for an active or recent consultation. */
  async vitalsForConsultation(user: AuthUser, appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt || appt.doctorId !== user.id) throw new NotFoundException();
    if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(appt.status)) throw new ForbiddenException('Consultation is not active');
    const out = await this.vitals(appt.patientId, 180);
    await this.audit.log(user, 'vitals.read', 'patient', appt.patientId, { appointmentId });
    return out;
  }
}

const Days = z.coerce.number().int().min(1).max(3650).optional();

@Controller()
export class WellnessController {
  constructor(private readonly svc: WellnessService) {}

  @Roles('PATIENT') @Get('me/vitals')
  vitals(@CurrentUser() u: AuthUser, @Query('days', new ZodPipe(Days)) days?: number, @Query('type') type?: string) {
    return this.svc.myVitals(u, days, type && (VITAL_TYPES as readonly string[]).includes(type) ? type : undefined);
  }

  @Roles('PATIENT') @Post('me/vitals')
  add(@CurrentUser() u: AuthUser, @Body(new ZodPipe(VitalDto)) body: VitalInput) {
    return this.svc.addVital(u, body);
  }

  @Roles('PATIENT') @Delete('me/vitals/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.deleteVital(u, id);
  }

  @Roles('PATIENT') @Get('me/medications')
  medications(@CurrentUser() u: AuthUser) {
    return this.svc.medications(u);
  }

  @Roles('PATIENT') @Get('me/health-summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u);
  }

  @Roles('DOCTOR') @Get('appointments/:id/vitals')
  consultationVitals(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.vitalsForConsultation(u, id);
  }
}

@Module({ controllers: [WellnessController], providers: [WellnessService] })
export class WellnessModule {}
