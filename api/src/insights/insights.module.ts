import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { NotificationsService, PrismaService, ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

const WEEKS = 12;

/** Monday 00:00 of the week containing `d`, in the given timezone. */
export function weekStart(d: Date, tz: string): DateTime {
  return DateTime.fromJSDate(d, { zone: tz }).startOf('week');
}

export function pctChange(now: number, before: number): number | null {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Practice analytics for the signed-in doctor. Aggregates only; no clinical content. */
  async doctor(user: AuthUser) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { doctor: true } });
    const tz = me.timezone || 'Asia/Kolkata';
    const now = DateTime.now().setZone(tz);
    const from = weekStart(now.toJSDate(), tz).minus({ weeks: WEEKS - 1 });
    const monthStart = now.startOf('month');
    const prevMonthStart = monthStart.minus({ months: 1 });

    const [appts, payments, reviews, ratingGroups] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { doctorId: user.id, startsAt: { gte: from.minus({ months: 1 }).toJSDate() } },
        select: { id: true, patientId: true, startsAt: true, status: true, completedAt: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'SUCCEEDED', appointment: { doctorId: user.id }, createdAt: { gte: prevMonthStart.toJSDate() < from.toJSDate() ? prevMonthStart.toJSDate() : from.toJSDate() } },
        select: { amountMinor: true, createdAt: true, currency: true },
      }),
      this.prisma.review.findMany({
        where: { doctorId: user.id }, orderBy: { createdAt: 'desc' }, take: 6,
        include: { appointment: { include: { patient: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
      }),
      this.prisma.review.groupBy({ by: ['rating'], where: { doctorId: user.id }, _count: true }),
    ]);

    const weeks = Array.from({ length: WEEKS }, (_, i) => from.plus({ weeks: i }));
    const weekIdx = (d: Date) => Math.floor(DateTime.fromJSDate(d, { zone: tz }).diff(from, 'weeks').weeks);
    const series = weeks.map((w) => ({ week: w.toISODate(), consultations: 0, earningsMinor: 0, noShows: 0 }));
    for (const a of appts) {
      const i = weekIdx(a.startsAt);
      if (i < 0 || i >= WEEKS) continue;
      if (a.status === 'COMPLETED') series[i].consultations++;
      if (a.status === 'NO_SHOW') series[i].noShows++;
    }
    for (const p of payments) {
      const i = weekIdx(p.createdAt);
      if (i >= 0 && i < WEEKS) series[i].earningsMinor += p.amountMinor;
    }

    const inRange = (d: Date | null, a: DateTime, b: DateTime) => !!d && d >= a.toJSDate() && d < b.toJSDate();
    const completed = appts.filter((a) => a.status === 'COMPLETED');
    const consultThis = completed.filter((a) => inRange(a.startsAt, monthStart, now.plus({ days: 1 }))).length;
    // Month-to-date vs the same number of days last month.
    const prevCut = DateTime.min(prevMonthStart.plus(now.diff(monthStart)), monthStart);
    const consultPrev = completed.filter((a) => inRange(a.startsAt, prevMonthStart, prevCut)).length;
    const earnThis = payments.filter((p) => inRange(p.createdAt, monthStart, now.plus({ days: 1 }))).reduce((s, p) => s + p.amountMinor, 0);
    const earnPrev = payments.filter((p) => inRange(p.createdAt, prevMonthStart, prevCut)).reduce((s, p) => s + p.amountMinor, 0);

    const finished = appts.filter((a) => ['COMPLETED', 'NO_SHOW'].includes(a.status) && a.startsAt >= from.toJSDate());
    const noShowRate = finished.length ? Math.round((finished.filter((a) => a.status === 'NO_SHOW').length / finished.length) * 100) : 0;

    const visits = new Map<string, number>();
    for (const a of completed) visits.set(a.patientId, (visits.get(a.patientId) ?? 0) + 1);
    const repeat = [...visits.values()].filter((n) => n > 1).length;

    // Busiest hours: weekday (1-7) × hour (0-23) counts of booked consultations.
    const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const a of appts) {
      if (!['COMPLETED', 'CONFIRMED', 'IN_PROGRESS', 'NO_SHOW'].includes(a.status)) continue;
      const t = DateTime.fromJSDate(a.startsAt, { zone: tz });
      heat[t.weekday - 1][t.hour]++;
    }

    const todayStart = now.startOf('day');
    const today = await this.prisma.appointment.findMany({
      where: { doctorId: user.id, startsAt: { gte: todayStart.toJSDate(), lt: todayStart.plus({ days: 1 }).toJSDate() }, status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] } },
      include: { patient: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { startsAt: 'asc' },
    });

    const distribution = [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: ratingGroups.find((g) => g.rating === r)?._count ?? 0 }));
    return {
      timezone: tz,
      currency: me.doctor?.currency ?? 'INR',
      kpis: {
        consultationsThisMonth: consultThis, consultationsChange: pctChange(consultThis, consultPrev),
        earningsThisMonthMinor: earnThis, earningsChange: pctChange(earnThis, earnPrev),
        rating: Math.round((me.doctor?.ratingAvg ?? 0) * 10) / 10, ratingCount: me.doctor?.ratingCount ?? 0,
        noShowRate, uniquePatients: visits.size, repeatPatientRate: visits.size ? Math.round((repeat / visits.size) * 100) : 0,
      },
      weekly: series,
      heatmap: heat,
      ratingDistribution: distribution,
      recentReviews: reviews.map((r) => ({
        rating: r.rating, comment: r.comment, createdAt: r.createdAt,
        patient: `${r.appointment.patient.user.firstName} ${r.appointment.patient.user.lastName.charAt(0)}.`,
      })),
      today: today.map((a) => ({ id: a.id, startsAt: a.startsAt, status: a.status, reference: a.reference, patient: `${a.patient.user.firstName} ${a.patient.user.lastName}` })),
    };
  }
}

const ReadDto = z.object({ ids: z.array(z.string().max(40)).max(100).optional() });

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService, private readonly notifications: NotificationsService) {}

  @Roles('DOCTOR') @Get('doctors/me/insights')
  doctorInsights(@CurrentUser() u: AuthUser) {
    return this.insights.doctor(u);
  }

  @Roles('PATIENT', 'DOCTOR', 'ADMIN') @Get('me/notifications')
  notificationsList(@CurrentUser() u: AuthUser) {
    return this.notifications.list(u.id);
  }

  @Roles('PATIENT', 'DOCTOR', 'ADMIN') @Post('me/notifications/read')
  markRead(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ReadDto)) body: z.infer<typeof ReadDto>) {
    return this.notifications.markRead(u.id, body.ids);
  }
}

@Module({ controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
