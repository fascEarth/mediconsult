import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Appointment, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService, CryptoService, MailService, NotificationsService, PrismaService } from '../common/common.module';
import type { AuthUser } from '../auth/auth.guard';
import { DoctorsService } from '../doctors/doctors.module';
import { createPaymentProvider, PaymentConfirmation } from '../payments/payment-provider';

export const CONSENT_VERSION = '2026-11-v1';
const HOLD_MINUTES = 10;
const JOIN_BEFORE_MIN = 10;
const JOIN_AFTER_MIN = 30;
const PATIENT_CANCEL_HOURS = 2;

export interface PrescriptionInput {
  diagnosis: string;
  items: { medicine: string; dosage: string; frequency: string; duration: string; instructions?: string }[];
  advice?: string;
  followUpDays?: number;
}

export interface NotesInput {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

const reference = () => {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `MC-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
};

@Injectable()
export class AppointmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentsService.name);
  private readonly payments = createPaymentProvider();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly doctors: DoctorsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Background jobs: expire unpaid holds, send reminders. Replace with BullMQ for multi-instance.
    this.timer = setInterval(() => void this.housekeeping().catch((e) => this.logger.error(e)), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ── Booking ──

  async book(user: AuthUser, input: { doctorId: string; startsAt: string; reason: string; consent: boolean; recordIds?: string[] }) {
    if (user.role !== 'PATIENT') throw new ForbiddenException('Only patients can book');
    if (!input.consent) throw new BadRequestException('Consent to tele-consultation is required');
    const startsAt = new Date(input.startsAt);
    const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId: input.doctorId } });
    if (!doctor || doctor.status !== 'VERIFIED') throw new NotFoundException('Doctor not found');

    // The slot must be one the doctor actually offers right now.
    const { slots } = await this.doctors.slots(input.doctorId, new Date(startsAt.getTime() - 86_400_000).toISOString(), 2);
    if (!slots.some((s) => s.getTime() === startsAt.getTime())) throw new ConflictException('This slot is no longer available');

    if (input.recordIds?.length) {
      const owned = await this.prisma.medicalRecord.count({ where: { id: { in: input.recordIds }, patientId: user.id } });
      if (owned !== input.recordIds.length) throw new ForbiddenException('Unknown record');
    }

    try {
      const appt = await this.prisma.$transaction(async (tx) => {
        await tx.appointment.updateMany({
          where: { doctorId: input.doctorId, startsAt, status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } },
          data: { status: 'EXPIRED' },
        });
        return tx.appointment.create({
          data: {
            reference: reference(), patientId: user.id, doctorId: input.doctorId, startsAt,
            endsAt: new Date(startsAt.getTime() + doctor.slotMinutes * 60_000), reason: input.reason,
            feeMinor: doctor.feeMinor, currency: doctor.currency,
            status: doctor.feeMinor === 0 ? 'CONFIRMED' : 'PENDING_PAYMENT',
            holdExpiresAt: doctor.feeMinor === 0 ? null : new Date(Date.now() + HOLD_MINUTES * 60_000),
            roomName: doctor.feeMinor === 0 ? this.newRoom() : null,
            consentVersion: CONSENT_VERSION, consentAt: new Date(),
            records: input.recordIds?.length ? { create: input.recordIds.map((recordId) => ({ recordId })) } : undefined,
          },
        });
      });
      await this.audit.log(user, 'appointment.book', 'appointment', appt.id, { doctorId: input.doctorId, startsAt });
      return this.present(appt, user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This slot was just taken. Please pick another.');
      throw e;
    }
  }

  async createPayment(user: AuthUser, id: string) {
    const appt = await this.forParticipant(user, id);
    if (appt.patientId !== user.id) throw new ForbiddenException();
    if (appt.status !== 'PENDING_PAYMENT' || !appt.holdExpiresAt || appt.holdExpiresAt < new Date()) throw new BadRequestException('Booking hold expired. Please book again.');
    const order = await this.payments.createOrder({ amountMinor: appt.feeMinor, currency: appt.currency, receipt: appt.reference });
    await this.prisma.payment.create({ data: { appointmentId: id, provider: order.provider, orderId: order.orderId, amountMinor: order.amountMinor, currency: order.currency } });
    return order;
  }

  async confirmPayment(user: AuthUser, id: string, confirmation: PaymentConfirmation) {
    const appt = await this.forParticipant(user, id);
    if (appt.patientId !== user.id) throw new ForbiddenException();
    const payment = await this.prisma.payment.findUnique({ where: { orderId: confirmation.orderId } });
    if (!payment || payment.appointmentId !== id) throw new BadRequestException('Unknown order');
    if (payment.status === 'SUCCEEDED') return this.get(user, id);
    if (!(await this.payments.verify(confirmation))) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      await this.audit.log(user, 'payment.verify_failed', 'appointment', id);
      throw new BadRequestException('Payment could not be verified');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', paymentId: confirmation.paymentId } });
      const r = await tx.appointment.updateMany({ where: { id, status: 'PENDING_PAYMENT' }, data: { status: 'CONFIRMED', holdExpiresAt: null, roomName: this.newRoom() } });
      if (!r.count) throw new ConflictException('Booking expired before payment completed; a refund will be issued');
      return tx.appointment.findUniqueOrThrow({ where: { id }, include: { patient: { include: { user: true } }, doctor: { include: { user: true } } } });
    });
    await this.audit.log(user, 'payment.succeeded', 'appointment', id, { orderId: confirmation.orderId });
    const when = updated.startsAt.toUTCString();
    const link = `${process.env.APP_URL ?? ''}/appointments/${id}`;
    await this.mail.send(updated.patient.user.email, `Consultation confirmed · ${updated.reference}`, `Your consultation with Dr. ${updated.doctor.user.lastName} is confirmed for ${when}.\nJoin from: ${link}`);
    await this.mail.send(updated.doctor.user.email, `New consultation · ${updated.reference}`, `New consultation booked for ${when}.\nDetails: ${link}`);
    const path = `/appointments/${id}`;
    await this.notifications.notify(updated.patientId, 'appointment.confirmed', 'Consultation confirmed', `With Dr. ${updated.doctor.user.firstName} ${updated.doctor.user.lastName} · ${updated.reference}`, path);
    await this.notifications.notify(updated.doctorId, 'appointment.booked', 'New consultation booked', `${updated.patient.user.firstName} ${updated.patient.user.lastName} · ${updated.reference}`, path);
    return this.present(updated, user);
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    const appt = await this.forParticipant(user, id);
    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(appt.status)) throw new BadRequestException('This appointment cannot be cancelled');
    if (user.role === 'PATIENT' && appt.status === 'CONFIRMED' && appt.startsAt.getTime() - Date.now() < PATIENT_CANCEL_HOURS * 3_600_000) {
      throw new BadRequestException(`Cancellations must be at least ${PATIENT_CANCEL_HOURS} hours before the start`);
    }
    await this.prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: user.role, cancelReason: reason, roomName: null } });
    const paid = await this.prisma.payment.findFirst({ where: { appointmentId: id, status: 'SUCCEEDED' } });
    if (paid?.paymentId && (await this.payments.refund(paid.paymentId, paid.amountMinor))) {
      await this.prisma.payment.update({ where: { id: paid.id }, data: { status: 'REFUNDED' } });
    }
    await this.audit.log(user, 'appointment.cancel', 'appointment', id, { reason });
    const other = user.id === appt.patientId ? appt.doctorId : appt.patientId;
    await this.notifications.notify(other, 'appointment.cancelled', 'Consultation cancelled', `${appt.reference} was cancelled${paid ? '; any payment is being refunded' : ''}`, `/appointments/${id}`);
    return this.get(user, id);
  }

  // ── Reading ──

  async mine(user: AuthUser, scope: 'upcoming' | 'past') {
    const now = new Date();
    const where: Prisma.AppointmentWhereInput = {
      ...(user.role === 'DOCTOR' ? { doctorId: user.id } : { patientId: user.id }),
      ...(scope === 'upcoming'
        ? { endsAt: { gte: new Date(now.getTime() - JOIN_AFTER_MIN * 60_000) }, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] } }
        : { OR: [{ endsAt: { lt: now } }, { status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] } }] }),
    };
    const rows = await this.prisma.appointment.findMany({
      where, include: { patient: { include: { user: true } }, doctor: { include: { user: true } }, prescription: { select: { id: true } }, review: { select: { rating: true } } },
      orderBy: { startsAt: scope === 'upcoming' ? 'asc' : 'desc' }, take: 100,
    });
    return rows.map((r) => this.present(r, user));
  }

  async get(user: AuthUser, id: string) {
    const appt = await this.forParticipant(user, id, true);
    const full = await this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: {
        patient: { include: { user: true } }, doctor: { include: { user: true } }, prescription: { select: { id: true } }, review: { select: { rating: true, comment: true } },
        records: { include: { record: { select: { id: true, title: true, mimeType: true, sizeBytes: true, createdAt: true } } } },
      },
    });
    if (user.role !== 'ADMIN') await this.audit.log(user, 'appointment.view', 'appointment', appt.id);
    return { ...this.present(full, user), records: full.records.map((r) => r.record) };
  }

  /** Room details only for participants, only inside the join window. */
  async join(user: AuthUser, id: string) {
    const appt = await this.forParticipant(user, id);
    if (user.role === 'ADMIN') throw new ForbiddenException();
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(appt.status) || !appt.roomName) throw new BadRequestException('This consultation is not active');
    const now = Date.now();
    const opens = appt.startsAt.getTime() - JOIN_BEFORE_MIN * 60_000;
    const closes = appt.endsAt.getTime() + JOIN_AFTER_MIN * 60_000;
    if (now < opens) throw new BadRequestException(`The room opens ${JOIN_BEFORE_MIN} minutes before the start`);
    if (now > closes) throw new BadRequestException('This consultation has ended');

    const isDoctor = appt.doctorId === user.id;
    await this.prisma.appointment.update({
      where: { id },
      data: isDoctor ? { doctorJoinedAt: appt.doctorJoinedAt ?? new Date(), status: 'IN_PROGRESS' } : { patientJoinedAt: appt.patientJoinedAt ?? new Date() },
    });
    await this.audit.log(user, 'consultation.join', 'appointment', id);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return {
      domain: process.env.JITSI_DOMAIN ?? 'meet.jit.si',
      roomName: appt.roomName,
      displayName: isDoctor ? `Dr. ${me.firstName} ${me.lastName}` : `${me.firstName} ${me.lastName}`,
      subject: `Consultation ${appt.reference}`,
      isModerator: isDoctor,
    };
  }

  // ── Clinical (doctor) ──

  async saveNotes(user: AuthUser, id: string, notes: NotesInput) {
    const appt = await this.asDoctor(user, id);
    this.assertClinicalWindow(appt);
    await this.prisma.consultationNote.upsert({
      where: { appointmentId: id }, create: { appointmentId: id, dataEnc: this.crypto.encryptJson(notes) }, update: { dataEnc: this.crypto.encryptJson(notes) },
    });
    await this.audit.log(user, 'notes.write', 'appointment', id);
    return notes;
  }

  async getNotes(user: AuthUser, id: string) {
    await this.asDoctor(user, id);
    const n = await this.prisma.consultationNote.findUnique({ where: { appointmentId: id } });
    await this.audit.log(user, 'notes.read', 'appointment', id);
    return n ? this.crypto.decryptJson<NotesInput>(n.dataEnc) : {};
  }

  async savePrescription(user: AuthUser, id: string, input: PrescriptionInput) {
    const appt = await this.asDoctor(user, id);
    this.assertClinicalWindow(appt);
    const dataEnc = this.crypto.encryptJson(input);
    const existed = await this.prisma.prescription.count({ where: { appointmentId: id } });
    await this.prisma.prescription.upsert({ where: { appointmentId: id }, create: { appointmentId: id, dataEnc }, update: { dataEnc } });
    await this.audit.log(user, 'prescription.write', 'appointment', id);
    await this.notifications.notify(appt.patientId, 'prescription.issued', existed ? 'Prescription updated' : 'Prescription ready', `For consultation ${appt.reference}`, `/prescription/${id}`);
    return this.getPrescription(user, id);
  }

  async getPrescription(user: AuthUser, id: string) {
    const appt = await this.forParticipant(user, id);
    if (user.role === 'ADMIN') throw new ForbiddenException();
    const p = await this.prisma.prescription.findUnique({ where: { appointmentId: id } });
    if (!p) throw new NotFoundException('No prescription yet');
    const full = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { patient: { include: { user: true } }, doctor: { include: { user: true } } } });
    await this.audit.log(user, 'prescription.read', 'appointment', id);
    return {
      id: p.id, reference: appt.reference, issuedAt: p.issuedAt, updatedAt: p.updatedAt,
      doctor: { name: `Dr. ${full.doctor.user.firstName} ${full.doctor.user.lastName}`, qualifications: full.doctor.qualifications, registrationNumber: full.doctor.registrationNumber, registrationCouncil: full.doctor.registrationCouncil, specialty: full.doctor.specialty },
      patient: { name: `${full.patient.user.firstName} ${full.patient.user.lastName}`, dateOfBirth: full.patient.dateOfBirth, gender: full.patient.gender },
      ...this.crypto.decryptJson<PrescriptionInput>(p.dataEnc),
    };
  }

  async complete(user: AuthUser, id: string) {
    const appt = await this.asDoctor(user, id);
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(appt.status)) throw new BadRequestException('Not active');
    if (Date.now() < appt.startsAt.getTime()) throw new BadRequestException('Cannot complete before the start time');
    await this.prisma.appointment.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await this.audit.log(user, 'appointment.complete', 'appointment', id);
    await this.notifications.notify(appt.patientId, 'appointment.completed', 'How was your consultation?', `Rate your consultation ${appt.reference}`, `/appointments/${id}`);
    return this.get(user, id);
  }

  async noShow(user: AuthUser, id: string) {
    const appt = await this.asDoctor(user, id);
    if (Date.now() < appt.startsAt.getTime() + 10 * 60_000) throw new BadRequestException('Wait at least 10 minutes after the start');
    if (appt.patientJoinedAt) throw new BadRequestException('The patient joined this consultation');
    await this.prisma.appointment.update({ where: { id }, data: { status: 'NO_SHOW' } });
    await this.audit.log(user, 'appointment.no_show', 'appointment', id);
    return this.get(user, id);
  }

  async review(user: AuthUser, id: string, rating: number, comment?: string) {
    const appt = await this.forParticipant(user, id);
    if (appt.patientId !== user.id) throw new ForbiddenException();
    if (appt.status !== 'COMPLETED') throw new BadRequestException('You can review after the consultation');
    await this.prisma.$transaction(async (tx) => {
      await tx.review.create({ data: { appointmentId: id, doctorId: appt.doctorId, rating, comment } });
      const agg = await tx.review.aggregate({ where: { doctorId: appt.doctorId }, _avg: { rating: true }, _count: true });
      await tx.doctorProfile.update({ where: { userId: appt.doctorId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Already reviewed');
      throw e;
    });
    await this.notifications.notify(appt.doctorId, 'review.received', `New ${rating}-star review`, `For consultation ${appt.reference}`, '/doctor/insights');
    return { ok: true };
  }

  // ── Helpers ──

  /** Loads an appointment the user is part of (admins: metadata only). */
  async forParticipant(user: AuthUser, id: string, allowAdmin = false): Promise<Appointment> {
    const appt = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundException();
    const isParty = appt.patientId === user.id || appt.doctorId === user.id;
    if (!isParty && !(allowAdmin && user.role === 'ADMIN')) throw new NotFoundException();
    return appt;
  }

  private async asDoctor(user: AuthUser, id: string) {
    const appt = await this.forParticipant(user, id);
    if (appt.doctorId !== user.id) throw new ForbiddenException('Only the treating doctor can do this');
    return appt;
  }

  private assertClinicalWindow(appt: Appointment) {
    if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(appt.status)) throw new BadRequestException('Consultation is not active');
    // Notes may be amended for 72h after completion, then they lock.
    if (appt.completedAt && Date.now() - appt.completedAt.getTime() > 72 * 3_600_000) throw new BadRequestException('Clinical record is locked');
  }

  private newRoom() {
    return `mc-${randomBytes(16).toString('hex')}`;
  }

  present(a: Appointment & { patient?: { user: { firstName: string; lastName: string } } | null; doctor?: { specialty: string; user: { firstName: string; lastName: string } } | null; prescription?: { id: string } | null; review?: { rating: number; comment?: string | null } | null }, viewer: AuthUser) {
    return {
      id: a.id, reference: a.reference, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt,
      reason: viewer.role === 'ADMIN' ? undefined : a.reason,
      fee: { amountMinor: a.feeMinor, currency: a.currency }, holdExpiresAt: a.holdExpiresAt,
      doctor: a.doctor ? { id: a.doctorId, name: `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`, specialty: a.doctor.specialty } : { id: a.doctorId },
      patient: a.patient ? { id: a.patientId, name: `${a.patient.user.firstName} ${a.patient.user.lastName}` } : { id: a.patientId },
      hasPrescription: !!a.prescription, review: a.review ?? null,
      canJoinFrom: new Date(a.startsAt.getTime() - JOIN_BEFORE_MIN * 60_000),
    };
  }

  private async housekeeping() {
    const expired = await this.prisma.appointment.updateMany({ where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    if (expired.count) this.logger.log(`Expired ${expired.count} unpaid holds`);

    const soon = await this.prisma.appointment.findMany({
      where: { status: 'CONFIRMED', reminderSentAt: null, startsAt: { gt: new Date(), lt: new Date(Date.now() + 60 * 60_000) } },
      include: { patient: { include: { user: true } }, doctor: { include: { user: true } } },
      take: 100,
    });
    for (const a of soon) {
      const link = `${process.env.APP_URL ?? ''}/appointments/${a.id}`;
      await this.mail.send(a.patient.user.email, `Reminder: consultation at ${a.startsAt.toUTCString()}`, `Your consultation ${a.reference} starts soon. Join here: ${link}`);
      await this.mail.send(a.doctor.user.email, `Reminder: consultation ${a.reference}`, `Starts at ${a.startsAt.toUTCString()}. ${link}`);
      await this.notifications.notify(a.patientId, 'appointment.reminder', 'Your consultation starts soon', `${a.reference} · the room opens 10 minutes before`, `/appointments/${a.id}`);
      await this.notifications.notify(a.doctorId, 'appointment.reminder', 'Consultation starts soon', `${a.patient.user.firstName} ${a.patient.user.lastName} · ${a.reference}`, `/appointments/${a.id}`);
      await this.prisma.appointment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
    }
  }
}
