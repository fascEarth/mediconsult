import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService, PrismaService } from '../common/common.module';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface Meta {
  ip?: string;
  userAgent?: string;
}

export interface DoctorApplication {
  specialty: string;
  qualifications: string;
  registrationNumber: string;
  registrationCouncil: string;
  experienceYears: number;
  languages: string[];
  feeMinor: number;
  bio?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService) {}

  async registerPatient(input: { email: string; password: string; firstName: string; lastName: string; phone?: string; timezone?: string }, meta: Meta) {
    const user = await this.createUser({ ...input, role: 'PATIENT' }, async (tx, id) => {
      await tx.patientProfile.create({ data: { userId: id } });
    });
    await this.audit.log({ id: user.id, role: 'PATIENT', ip: meta.ip }, 'auth.register', 'user', user.id);
    return this.issue(user, meta);
  }

  /** Doctors apply; they stay invisible until an admin verifies their registration. */
  async registerDoctor(input: { email: string; password: string; firstName: string; lastName: string; phone?: string; timezone?: string } & DoctorApplication, meta: Meta) {
    const user = await this.createUser({ ...input, role: 'DOCTOR' }, async (tx, id) => {
      await tx.doctorProfile.create({
        data: {
          userId: id, specialty: input.specialty, qualifications: input.qualifications,
          registrationNumber: input.registrationNumber, registrationCouncil: input.registrationCouncil,
          experienceYears: input.experienceYears, languages: input.languages, feeMinor: input.feeMinor, bio: input.bio,
        },
      });
    });
    await this.audit.log({ id: user.id, role: 'DOCTOR', ip: meta.ip }, 'auth.register_doctor', 'user', user.id);
    return this.issue(user, meta);
  }

  async login(email: string, password: string, meta: Meta) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const fail = new UnauthorizedException('Invalid email or password');
    if (!user) {
      await argon2.hash(password); // equalise timing for unknown emails
      throw fail;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked after too many attempts. Try again later.');
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await this.audit.log({ id: user.id, ip: meta.ip }, 'auth.login_failed', 'user', user.id);
      throw fail;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log({ id: user.id, role: user.role, ip: meta.ip }, 'auth.login', 'user', user.id);
    return this.issue(user, meta);
  }

  async refresh(token: string, meta: Meta) {
    const [sid, secret] = (token ?? '').split('.');
    const session = sid ? await this.prisma.session.findUnique({ where: { id: sid }, include: { user: true } }) : null;
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException();
    await this.prisma.session.update({ where: { id: sid }, data: { revokedAt: new Date() } });
    if (session.refreshTokenHash !== sha256(secret ?? '')) {
      // Reused (stolen) refresh token: revoke every session of this user.
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session revoked');
    }
    return this.issue(session.user, meta);
  }

  async logout(token: string) {
    const [sid] = (token ?? '').split('.');
    if (sid) await this.prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { doctor: true, patient: true } });
    return this.publicUser(user);
  }

  publicUser(user: User & { doctor?: { status: string } | null }) {
    return {
      id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName,
      phone: user.phone, timezone: user.timezone, doctorStatus: user.doctor?.status,
    };
  }

  private async createUser(
    input: { email: string; password: string; firstName: string; lastName: string; phone?: string; timezone?: string; role: Role },
    extra: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], id: string) => Promise<void>,
  ) {
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, role: input.role, firstName: input.firstName, lastName: input.lastName, phone: input.phone, timezone: input.timezone ?? 'Asia/Kolkata' },
      });
      await extra(tx, user.id);
      return user;
    });
  }

  private async issue(user: User, meta: Meta) {
    const secret = randomBytes(48).toString('hex');
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7);
    const session = await this.prisma.session.create({
      data: { userId: user.id, refreshTokenHash: sha256(secret), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255), expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, sid: session.id },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as never },
    );
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { doctor: true } });
    return { accessToken, refreshToken: `${session.id}.${secret}`, user: this.publicUser(full) };
  }
}
