import { BadRequestException, Global, Injectable, Logger, Module, OnModuleDestroy, PipeTransform } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import type { ZodSchema } from 'zod';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }
}

/**
 * AES-256-GCM field encryption for PHI (notes, prescriptions, chat, medical summary).
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url). Rotate by adding v2 with a new key.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.DATA_ENCRYPTION_KEY ?? '';
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split('.');
    if (v !== 'v1') throw new Error('Unknown ciphertext version');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown) {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}

export interface Actor {
  id?: string;
  role?: string;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(actor: Actor, action: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, actorRole: actor.role, action, entity, entityId, ip: actor.ip, meta: meta as Prisma.InputJsonValue },
    });
  }
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  /** Never put clinical details in email: only times, names and links. */
  async send(to: string, subject: string, text: string) {
    try {
      await this.transport.sendMail({ from: process.env.MAIL_FROM ?? 'MediConsult <no-reply@mediconsult.local>', to, subject, text });
    } catch (err) {
      this.logger.warn(`Mail to ${to} failed: ${(err as Error).message}`);
    }
  }
}

/** In-app notifications. Never put clinical details in title/body: names, times and links only. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, type: string, title: string, body: string, link?: string) {
    try {
      await this.prisma.notification.create({ data: { userId, type, title: title.slice(0, 140), body: body.slice(0, 500), link } });
    } catch (err) {
      this.logger.warn(`Notification for ${userId} failed: ${(err as Error).message}`);
    }
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { unread, items: items.map(({ userId: _u, ...n }) => n) };
  }

  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return this.list(userId);
  }
}

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException({ message: r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    return r.data;
  }
}

@Global()
@Module({
  providers: [PrismaService, CryptoService, AuditService, MailService, NotificationsService],
  exports: [PrismaService, CryptoService, AuditService, MailService, NotificationsService],
})
export class CommonModule {}
