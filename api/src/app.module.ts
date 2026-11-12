import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule, PrismaService } from './common/common.module';
import { AuthGuard, Public } from './auth/auth.guard';
import { AuthModule } from './auth/auth.controller';
import { DoctorsModule } from './doctors/doctors.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { PatientsModule } from './patients/patients.module';
import { AdminModule } from './admin/admin.module';

@Controller()
class MetaController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get('health')
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down');
    return { status: db === 'up' ? 'ok' : 'degraded', db };
  }

  /** Public config for the web app (no secrets). */
  @Public() @Get('config')
  config() {
    return {
      demoMode: process.env.DEMO_MODE === 'true',
      paymentProvider: process.env.PAYMENT_PROVIDER ?? 'demo',
      razorpayKeyId: process.env.PAYMENT_PROVIDER === 'razorpay' ? process.env.RAZORPAY_KEY_ID : undefined,
      jitsiDomain: process.env.JITSI_DOMAIN ?? 'meet.jit.si',
      consentVersion: '2026-11-v1',
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
    JwtModule.register({ global: true }),
    CommonModule,
    AuthModule,
    DoctorsModule,
    AppointmentsModule,
    PatientsModule,
    AdminModule,
  ],
  controllers: [MetaController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
