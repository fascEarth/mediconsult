import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService, MailService, NotificationsService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly mail: MailService, private readonly notifications: NotificationsService) {}

  async doctors(status?: string) {
    const rows = await this.prisma.doctorProfile.findMany({
      where: status ? { status: status as never } : {},
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: d.userId, name: `Dr. ${d.user.firstName} ${d.user.lastName}`, email: d.user.email, status: d.status,
      specialty: d.specialty, qualifications: d.qualifications, registrationNumber: d.registrationNumber,
      registrationCouncil: d.registrationCouncil, experienceYears: d.experienceYears, createdAt: d.createdAt,
    }));
  }

  /** Admin confirms the medical registration with the council before approving. */
  async setDoctorStatus(admin: AuthUser, doctorId: string, status: 'VERIFIED' | 'SUSPENDED', note?: string) {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId: doctorId }, include: { user: true } });
    if (!d) throw new NotFoundException();
    await this.prisma.doctorProfile.update({ where: { userId: doctorId }, data: { status, verifiedAt: status === 'VERIFIED' ? new Date() : d.verifiedAt } });
    await this.audit.log(admin, `admin.doctor_${status.toLowerCase()}`, 'doctor', doctorId, { note });
    await this.mail.send(d.user.email, status === 'VERIFIED' ? 'Your MediConsult profile is live' : 'Your MediConsult profile was suspended',
      status === 'VERIFIED' ? 'Your registration has been verified. Set your availability to start receiving bookings.' : `Reason: ${note ?? 'contact support'}`);
    await this.notifications.notify(doctorId, `doctor.${status.toLowerCase()}`, status === 'VERIFIED' ? 'Your profile is verified' : 'Your profile was suspended',
      status === 'VERIFIED' ? 'Patients can now book you. Check your availability.' : `Reason: ${note ?? 'contact support'}`, status === 'VERIFIED' ? '/doctor/settings' : undefined);
    return { ok: true };
  }

  async stats() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [patients, doctors, pending, upcoming, completed30, revenue30] = await Promise.all([
      this.prisma.user.count({ where: { role: 'PATIENT' } }),
      this.prisma.doctorProfile.count({ where: { status: 'VERIFIED' } }),
      this.prisma.doctorProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.appointment.count({ where: { status: 'CONFIRMED', startsAt: { gte: new Date() } } }),
      this.prisma.appointment.count({ where: { status: 'COMPLETED', completedAt: { gte: since } } }),
      this.prisma.payment.aggregate({ where: { status: 'SUCCEEDED', createdAt: { gte: since } }, _sum: { amountMinor: true } }),
    ]);
    return { patients, doctors, pendingDoctors: pending, upcoming, completed30, revenue30Minor: revenue30._sum.amountMinor ?? 0 };
  }

  /** Platform analytics for the last 30 days (aggregates only). */
  async analytics() {
    const DAYS = 30;
    const start = new Date(Date.now() - (DAYS - 1) * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);
    const [appts, payments, doctors] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { createdAt: { gte: start } },
        select: { status: true, createdAt: true, doctorId: true, doctor: { select: { specialty: true } } },
      }),
      this.prisma.payment.findMany({ where: { status: { in: ['SUCCEEDED', 'REFUNDED'] }, createdAt: { gte: start } }, select: { amountMinor: true, status: true, createdAt: true } }),
      this.prisma.doctorProfile.findMany({ where: { status: 'VERIFIED' }, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const daily = Array.from({ length: DAYS }, (_, i) => ({ date: day(new Date(start.getTime() + i * 86_400_000)), bookings: 0, revenueMinor: 0 }));
    const idx = new Map(daily.map((d, i) => [d.date, i]));
    for (const a of appts) {
      const i = idx.get(day(a.createdAt));
      if (i !== undefined && a.status !== 'EXPIRED') daily[i].bookings++;
    }
    for (const p of payments) {
      const i = idx.get(day(p.createdAt));
      if (i !== undefined && p.status === 'SUCCEEDED') daily[i].revenueMinor += p.amountMinor;
    }
    const byStatus: Record<string, number> = {};
    const bySpecialty: Record<string, number> = {};
    const byDoctor: Record<string, number> = {};
    for (const a of appts) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      if (['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) {
        bySpecialty[a.doctor.specialty] = (bySpecialty[a.doctor.specialty] ?? 0) + 1;
        byDoctor[a.doctorId] = (byDoctor[a.doctorId] ?? 0) + 1;
      }
    }
    const booked = appts.length;
    const paid = appts.filter((a) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'].includes(a.status)).length;
    const cancelled = byStatus['CANCELLED'] ?? 0;
    return {
      days: DAYS,
      daily,
      byStatus,
      bySpecialty: Object.entries(bySpecialty).map(([specialty, count]) => ({ specialty, count })).sort((a, b) => b.count - a.count),
      conversionRate: booked ? Math.round((paid / booked) * 100) : 0,
      cancellationRate: booked ? Math.round((cancelled / booked) * 100) : 0,
      refundsMinor: payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amountMinor, 0),
      topDoctors: doctors
        .map((d) => ({ id: d.userId, name: `Dr. ${d.user.firstName} ${d.user.lastName}`, specialty: d.specialty, consultations: byDoctor[d.userId] ?? 0, rating: Math.round(d.ratingAvg * 10) / 10, ratingCount: d.ratingCount }))
        .sort((a, b) => b.consultations - a.consultations || b.rating - a.rating)
        .slice(0, 6),
    };
  }

  /** Consultation metadata for operations. No reason, notes or prescriptions. */
  async appointments(q: { status?: string; search?: string; page?: number }) {
    const take = 25;
    const page = Math.max(1, q.page ?? 1);
    const search = q.search?.trim();
    const where = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(search ? { OR: [
        { reference: { contains: search, mode: 'insensitive' as const } },
        { patient: { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' as const } }, { lastName: { contains: search, mode: 'insensitive' as const } }] } } },
        { doctor: { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' as const } }, { lastName: { contains: search, mode: 'insensitive' as const } }] } } },
      ] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where, orderBy: { startsAt: 'desc' }, skip: (page - 1) * take, take,
        include: { patient: { include: { user: true } }, doctor: { include: { user: true } }, payments: { select: { status: true, amountMinor: true } } },
      }),
    ]);
    return {
      total, page, pageSize: take,
      items: rows.map((a) => ({
        id: a.id, reference: a.reference, status: a.status, startsAt: a.startsAt, createdAt: a.createdAt,
        fee: { amountMinor: a.feeMinor, currency: a.currency },
        payment: a.payments.find((p) => p.status === 'SUCCEEDED' || p.status === 'REFUNDED')?.status ?? null,
        patient: `${a.patient.user.firstName} ${a.patient.user.lastName}`,
        doctor: `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`, specialty: a.doctor.specialty,
      })),
    };
  }

  async auditLog(entityId?: string) {
    const rows = await this.prisma.auditLog.findMany({ where: entityId ? { entityId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}

const ApptQuery = z.object({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']).optional().or(z.literal('').transform(() => undefined)),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

const StatusDto = z.object({ status: z.enum(['VERIFIED', 'SUSPENDED']), note: z.string().max(500).optional() });

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('doctors')
  doctors(@Query('status') status?: string) {
    return this.admin.doctors(status);
  }

  @Post('doctors/:id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(StatusDto)) body: z.infer<typeof StatusDto>) {
    return this.admin.setDoctorStatus(u, id, body.status, body.note);
  }

  @Get('analytics')
  analytics() {
    return this.admin.analytics();
  }

  @Get('appointments')
  appointments(@Query(new ZodPipe(ApptQuery)) q: z.infer<typeof ApptQuery>) {
    return this.admin.appointments(q);
  }

  @Get('audit')
  audit(@Query('entityId') entityId?: string) {
    return this.admin.auditLog(entityId);
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
