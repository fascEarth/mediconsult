import { BadRequestException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { CryptoService, PrismaService } from '../common/common.module';
import type { AuthUser } from '../auth/auth.guard';
import { AppointmentsService } from './appointments.service';

// ChatGateway is declared first: MessagesService references it in constructor metadata,
// which is evaluated at class definition time (TDZ crash otherwise).
@Injectable()
@WebSocketGateway({ namespace: '/chat', cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4300').split(','), credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService, @Inject(forwardRef(() => AppointmentsService)) private readonly appts: AppointmentsService) {}

  async handleConnection(socket: Socket) {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; role: AuthUser['role']; sid: string }>(String(socket.handshake.auth?.token ?? ''), { secret: process.env.JWT_ACCESS_SECRET });
      socket.data.user = { id: claims.sub, role: claims.role, sid: claims.sid } satisfies AuthUser;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: { appointmentId: string }) {
    const user = socket.data.user as AuthUser | undefined;
    if (!user || !body?.appointmentId) return { ok: false };
    try {
      await this.appts.forParticipant(user, body.appointmentId);
      await socket.join(`appt:${body.appointmentId}`);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  broadcast(appointmentId: string, message: unknown) {
    this.server?.to(`appt:${appointmentId}`).emit('message', message);
  }
}

/** Encrypted per-consultation chat. REST for history, socket for live delivery. */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly appts: AppointmentsService,
    @Inject(forwardRef(() => ChatGateway)) private readonly gateway: ChatGateway,
  ) {}

  async list(user: AuthUser, appointmentId: string) {
    await this.appts.forParticipant(user, appointmentId);
    const rows = await this.prisma.message.findMany({ where: { appointmentId }, orderBy: { createdAt: 'asc' }, take: 500 });
    return rows.map((m) => ({ id: m.id, senderId: m.senderId, body: this.crypto.decrypt(m.bodyEnc), createdAt: m.createdAt }));
  }

  async send(user: AuthUser, appointmentId: string, body: string) {
    const appt = await this.appts.forParticipant(user, appointmentId);
    if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(appt.status)) throw new BadRequestException('Chat is not open for this appointment');
    if (appt.status === 'COMPLETED' && appt.completedAt && Date.now() - appt.completedAt.getTime() > 7 * 86_400_000) {
      throw new BadRequestException('Chat closed 7 days after the consultation');
    }
    const m = await this.prisma.message.create({ data: { appointmentId, senderId: user.id, bodyEnc: this.crypto.encrypt(body) } });
    const out = { id: m.id, senderId: m.senderId, body, createdAt: m.createdAt };
    this.gateway.broadcast(appointmentId, out);
    return out;
  }
}
