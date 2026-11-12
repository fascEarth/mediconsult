import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService, MailService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly mail: MailService) {}

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

  async auditLog(entityId?: string) {
    const rows = await this.prisma.auditLog.findMany({ where: entityId ? { entityId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}

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

  @Get('audit')
  audit(@Query('entityId') entityId?: string) {
    return this.admin.auditLog(entityId);
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
