import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Put, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth.guard';
import { generateSlots, isValidTime } from './slots';

const LIVE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

@Injectable()
export class DoctorsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async search(q: { specialty?: string; language?: string; search?: string; page?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const where: Prisma.DoctorProfileWhereInput = {
      status: 'VERIFIED',
      ...(q.specialty ? { specialty: { equals: q.specialty, mode: 'insensitive' } } : {}),
      ...(q.language ? { languages: { has: q.language } } : {}),
      ...(q.search
        ? { OR: [
            { specialty: { contains: q.search, mode: 'insensitive' } },
            { user: { firstName: { contains: q.search, mode: 'insensitive' } } },
            { user: { lastName: { contains: q.search, mode: 'insensitive' } } },
          ] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.doctorProfile.count({ where }),
      this.prisma.doctorProfile.findMany({
        where, include: { user: true }, orderBy: [{ ratingAvg: 'desc' }, { experienceYears: 'desc' }], skip: (page - 1) * 12, take: 12,
      }),
    ]);
    return { total, page, items: rows.map((d) => this.present(d)) };
  }

  async specialties() {
    const rows = await this.prisma.doctorProfile.groupBy({ by: ['specialty'], where: { status: 'VERIFIED' }, _count: true, orderBy: { specialty: 'asc' } });
    return rows.map((r) => ({ specialty: r.specialty, doctors: r._count }));
  }

  async profile(id: string, includeUnverified = false) {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId: id }, include: { user: true } });
    if (!d || (!includeUnverified && d.status !== 'VERIFIED')) throw new NotFoundException('Doctor not found');
    const reviews = await this.prisma.review.findMany({ where: { doctorId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { rating: true, comment: true, createdAt: true } });
    return { ...this.present(d), reviews };
  }

  async slots(doctorId: string, fromIso?: string, days = 7) {
    const d = await this.prisma.doctorProfile.findUnique({ where: { userId: doctorId }, include: { availability: true, user: true } });
    if (!d || d.status !== 'VERIFIED') throw new NotFoundException('Doctor not found');
    const from = fromIso ? new Date(fromIso) : new Date();
    if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid from date');
    const span = Math.min(Math.max(days, 1), 14);
    const to = new Date(from.getTime() + (span + 1) * 86_400_000);

    const [appointments, timeOff] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          doctorId, startsAt: { gte: new Date(from.getTime() - 86_400_000), lt: to }, status: { in: [...LIVE_STATUSES] },
          OR: [{ status: { not: 'PENDING_PAYMENT' } }, { holdExpiresAt: { gt: new Date() } }],
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.timeOff.findMany({ where: { doctorId, endsAt: { gt: from }, startsAt: { lt: to } }, select: { startsAt: true, endsAt: true } }),
    ]);

    const slots = generateSlots(d.availability, [...appointments, ...timeOff], {
      timezone: d.user.timezone, slotMinutes: d.slotMinutes, from, days: span,
    });
    return { doctorTimezone: d.user.timezone, slotMinutes: d.slotMinutes, slots };
  }

  // ── Doctor self-service ──
  async myProfile(user: AuthUser) {
    const d = await this.prisma.doctorProfile.findUniqueOrThrow({ where: { userId: user.id }, include: { user: true, availability: true, timeOff: { where: { endsAt: { gt: new Date() } } } } });
    return { ...this.present(d), status: d.status, registrationNumber: d.registrationNumber, registrationCouncil: d.registrationCouncil, availability: d.availability, timeOff: d.timeOff };
  }

  async updateProfile(user: AuthUser, input: { bio?: string; feeMinor?: number; languages?: string[]; slotMinutes?: number; photoUrl?: string }) {
    await this.prisma.doctorProfile.update({ where: { userId: user.id }, data: input });
    await this.audit.log(user, 'doctor.profile_update', 'doctor', user.id, { fields: Object.keys(input) });
    return this.myProfile(user);
  }

  async setAvailability(user: AuthUser, rules: { weekday: number; startTime: string; endTime: string }[]) {
    for (const r of rules) {
      if (!isValidTime(r.startTime) || !isValidTime(r.endTime) || r.startTime >= r.endTime) throw new BadRequestException(`Invalid hours ${r.startTime}-${r.endTime}`);
    }
    // Reject overlapping blocks on the same weekday.
    for (let wd = 1; wd <= 7; wd++) {
      const day = rules.filter((r) => r.weekday === wd).sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < day.length; i++) if (day[i].startTime < day[i - 1].endTime) throw new BadRequestException('Overlapping hours');
    }
    await this.prisma.$transaction([
      this.prisma.availabilityRule.deleteMany({ where: { doctorId: user.id } }),
      this.prisma.availabilityRule.createMany({ data: rules.map((r) => ({ ...r, doctorId: user.id })) }),
    ]);
    await this.audit.log(user, 'doctor.availability_update', 'doctor', user.id);
    return this.myProfile(user);
  }

  async addTimeOff(user: AuthUser, input: { startsAt: string; endsAt: string; reason?: string }) {
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!(startsAt < endsAt)) throw new BadRequestException('End must be after start');
    return this.prisma.timeOff.create({ data: { doctorId: user.id, startsAt, endsAt, reason: input.reason } });
  }

  async removeTimeOff(user: AuthUser, id: string) {
    await this.prisma.timeOff.deleteMany({ where: { id, doctorId: user.id } });
    return { ok: true };
  }

  present(d: Prisma.DoctorProfileGetPayload<{ include: { user: true } }>) {
    return {
      id: d.userId, name: `Dr. ${d.user.firstName} ${d.user.lastName}`, specialty: d.specialty, qualifications: d.qualifications,
      experienceYears: d.experienceYears, languages: d.languages, bio: d.bio, photoUrl: d.photoUrl,
      fee: { amountMinor: d.feeMinor, currency: d.currency }, slotMinutes: d.slotMinutes,
      rating: { average: Math.round(d.ratingAvg * 10) / 10, count: d.ratingCount }, verified: d.status === 'VERIFIED',
      timezone: d.user.timezone,
    };
  }
}

const ProfileDto = z.object({
  bio: z.string().max(2000).optional(), feeMinor: z.number().int().min(0).max(10_000_000).optional(),
  languages: z.array(z.string().min(2).max(30)).min(1).max(10).optional(), slotMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]).optional(),
  photoUrl: z.string().url().startsWith('https://').optional(),
});
const AvailabilityDto = z.object({ rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), startTime: z.string(), endTime: z.string() })).max(50) });
const TimeOffDto = z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().max(200).optional() });

@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Public() @Get()
  search(@Query() q: { specialty?: string; language?: string; search?: string; page?: number }) {
    return this.doctors.search(q);
  }

  @Public() @Get('specialties')
  specialties() {
    return this.doctors.specialties();
  }

  @Roles('DOCTOR') @Get('me/profile')
  me(@CurrentUser() user: AuthUser) {
    return this.doctors.myProfile(user);
  }

  @Roles('DOCTOR') @Put('me/profile')
  update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ProfileDto)) body: z.infer<typeof ProfileDto>) {
    return this.doctors.updateProfile(user, body);
  }

  @Roles('DOCTOR') @Put('me/availability')
  availability(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AvailabilityDto)) body: z.infer<typeof AvailabilityDto>) {
    return this.doctors.setAvailability(user, body.rules);
  }

  @Roles('DOCTOR') @Post('me/time-off')
  timeOff(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TimeOffDto)) body: z.infer<typeof TimeOffDto>) {
    return this.doctors.addTimeOff(user, body);
  }

  @Roles('DOCTOR') @Delete('me/time-off/:id')
  removeTimeOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.doctors.removeTimeOff(user, id);
  }

  @Public() @Get(':id')
  profile(@Param('id') id: string) {
    return this.doctors.profile(id);
  }

  @Public() @Get(':id/slots')
  slots(@Param('id') id: string, @Query('from') from?: string, @Query('days') days?: string) {
    return this.doctors.slots(id, from, Number(days) || 7);
  }
}

@Module({ controllers: [DoctorsController], providers: [DoctorsService], exports: [DoctorsService] })
export class DoctorsModule {}
