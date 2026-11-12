import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService, CryptoService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

const ALLOWED = new Map([
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]], // %PDF
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
]);
const MAX_BYTES = 10 * 1024 * 1024;
const uploadDir = () => resolve(process.env.UPLOAD_DIR ?? './uploads');

/**
 * Patient health records. Files are encrypted at rest (AES-256-GCM) with
 * random storage keys; type is checked by magic bytes, not just the header.
 */
@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  async profile(user: AuthUser) {
    const p = await this.prisma.patientProfile.findUniqueOrThrow({ where: { userId: user.id }, include: { user: true } });
    return {
      firstName: p.user.firstName, lastName: p.user.lastName, email: p.user.email, phone: p.user.phone, timezone: p.user.timezone,
      dateOfBirth: p.dateOfBirth, gender: p.gender, bloodGroup: p.bloodGroup, emergencyContact: p.emergencyContact,
      medicalSummary: p.medicalSummaryEnc ? this.crypto.decryptJson(p.medicalSummaryEnc) : { allergies: '', conditions: '', medications: '' },
    };
  }

  async updateProfile(user: AuthUser, input: z.infer<typeof ProfileDto>) {
    const { medicalSummary, phone, timezone, ...rest } = input;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { phone, timezone } }),
      this.prisma.patientProfile.update({
        where: { userId: user.id },
        data: { ...rest, dateOfBirth: rest.dateOfBirth ? new Date(rest.dateOfBirth) : undefined, medicalSummaryEnc: medicalSummary ? this.crypto.encryptJson(medicalSummary) : undefined },
      }),
    ]);
    await this.audit.log(user, 'patient.profile_update', 'patient', user.id);
    return this.profile(user);
  }

  async records(user: AuthUser) {
    return this.prisma.medicalRecord.findMany({ where: { patientId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } });
  }

  async upload(user: AuthUser, title: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File required');
    if (file.size > MAX_BYTES) throw new BadRequestException('Max 10 MB');
    const magic = ALLOWED.get(file.mimetype);
    if (!magic || !magic.every((b, i) => file.buffer[i] === b)) throw new BadRequestException('Only PDF, PNG or JPEG files');

    const storageKey = randomBytes(24).toString('hex');
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(join(uploadDir(), storageKey), this.crypto.encrypt(file.buffer.toString('base64')));
    const rec = await this.prisma.medicalRecord.create({
      data: { patientId: user.id, title: title.slice(0, 200), fileName: file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 200), mimeType: file.mimetype, sizeBytes: file.size, storageKey },
    });
    await this.audit.log(user, 'record.upload', 'medical_record', rec.id);
    return { id: rec.id, title: rec.title, fileName: rec.fileName, mimeType: rec.mimeType, sizeBytes: rec.sizeBytes, createdAt: rec.createdAt };
  }

  /** Patient: own records. Doctor: only records shared with one of their consultations. */
  async download(user: AuthUser, id: string) {
    const rec = await this.prisma.medicalRecord.findUnique({ where: { id }, include: { appointments: { include: { appointment: true } } } });
    if (!rec) throw new NotFoundException();
    const allowed = rec.patientId === user.id || (user.role === 'DOCTOR' && rec.appointments.some((a) => a.appointment.doctorId === user.id));
    if (!allowed) throw new NotFoundException();
    const enc = await readFile(join(uploadDir(), rec.storageKey), 'utf8');
    await this.audit.log(user, 'record.download', 'medical_record', id);
    return { rec, buffer: Buffer.from(this.crypto.decrypt(enc), 'base64') };
  }

  async remove(user: AuthUser, id: string) {
    const rec = await this.prisma.medicalRecord.findFirst({ where: { id, patientId: user.id } });
    if (!rec) throw new NotFoundException();
    await this.prisma.medicalRecord.delete({ where: { id } });
    await unlink(join(uploadDir(), rec.storageKey)).catch(() => undefined);
    await this.audit.log(user, 'record.delete', 'medical_record', id);
    return { ok: true };
  }

  /** Data portability: everything we hold about the patient, decrypted. */
  async export(user: AuthUser) {
    const [profile, records, appointments] = await Promise.all([
      this.profile(user),
      this.records(user),
      this.prisma.appointment.findMany({ where: { patientId: user.id }, include: { prescription: true, doctor: { include: { user: true } } } }),
    ]);
    await this.audit.log(user, 'patient.export', 'patient', user.id);
    return {
      exportedAt: new Date(), profile, records,
      appointments: appointments.map((a) => ({
        reference: a.reference, startsAt: a.startsAt, status: a.status, reason: a.reason,
        doctor: `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
        prescription: a.prescription ? this.crypto.decryptJson(a.prescription.dataEnc) : null,
      })),
    };
  }

  async requestDeletion(user: AuthUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } });
    await this.audit.log(user, 'patient.deletion_requested', 'patient', user.id);
    return { ok: true, message: 'Your request is recorded. Clinical records are retained as required by law; everything else is deleted within 30 days.' };
  }
}

const ProfileDto = z.object({
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
  timezone: z.string().max(60).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  emergencyContact: z.string().max(200).optional(),
  medicalSummary: z.object({ allergies: z.string().max(2000), conditions: z.string().max(2000), medications: z.string().max(2000) }).optional(),
});

@Controller('me')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Roles('PATIENT') @Get('profile')
  profile(@CurrentUser() u: AuthUser) {
    return this.patients.profile(u);
  }

  @Roles('PATIENT') @Put('profile')
  update(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ProfileDto)) body: z.infer<typeof ProfileDto>) {
    return this.patients.updateProfile(u, body);
  }

  @Roles('PATIENT') @Get('records')
  records(@CurrentUser() u: AuthUser) {
    return this.patients.records(u);
  }

  @Roles('PATIENT') @Post('records')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body('title') title: string) {
    return this.patients.upload(u, title || file?.originalname || 'Record', file);
  }

  @Roles('PATIENT') @Delete('records/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.patients.remove(u, id);
  }

  @Roles('PATIENT') @Get('export')
  export(@CurrentUser() u: AuthUser) {
    return this.patients.export(u);
  }

  @Roles('PATIENT') @Post('delete-request')
  deletion(@CurrentUser() u: AuthUser) {
    return this.patients.requestDeletion(u);
  }
}

@Controller('records')
export class RecordsController {
  constructor(private readonly patients: PatientsService) {}

  @Roles('PATIENT', 'DOCTOR') @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { rec, buffer } = await this.patients.download(u, id);
    res.set({
      'Content-Type': rec.mimeType,
      'Content-Disposition': `attachment; filename="${rec.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(buffer);
  }
}

@Module({ controllers: [PatientsController, RecordsController], providers: [PatientsService] })
export class PatientsModule {}
