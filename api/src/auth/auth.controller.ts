import { Body, Controller, Get, HttpCode, Module, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/common.module';
import { AuthUser, CurrentUser, Public } from './auth.guard';
import { AuthService } from './auth.service';

const password = z.string().min(10, 'at least 10 characters').max(128)
  .regex(/[A-Z]/, 'needs an uppercase letter').regex(/[a-z]/, 'needs a lowercase letter').regex(/\d/, 'needs a number');
const base = {
  email: z.string().email().max(200),
  password,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
  timezone: z.string().max(60).optional(),
};
const PatientDto = z.object(base);
const DoctorDto = z.object({
  ...base,
  specialty: z.string().min(2).max(80),
  qualifications: z.string().min(2).max(200),
  registrationNumber: z.string().min(3).max(60),
  registrationCouncil: z.string().min(2).max(120),
  experienceYears: z.number().int().min(0).max(70),
  languages: z.array(z.string().min(2).max(30)).min(1).max(10),
  feeMinor: z.number().int().min(0).max(10_000_000),
  bio: z.string().max(2000).optional(),
});
const LoginDto = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
const RefreshDto = z.object({ refreshToken: z.string().min(10) });
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body(new ZodPipe(PatientDto)) body: z.infer<typeof PatientDto>, @Req() req: Request) {
    return this.auth.registerPatient(body, meta(req));
  }

  @Public() @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register-doctor')
  registerDoctor(@Body(new ZodPipe(DoctorDto)) body: z.infer<typeof DoctorDto>, @Req() req: Request) {
    return this.auth.registerDoctor(body, meta(req));
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(LoginDto)) body: z.infer<typeof LoginDto>, @Req() req: Request) {
    return this.auth.login(body.email, body.password, meta(req));
  }

  @Public() @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(RefreshDto)) body: z.infer<typeof RefreshDto>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Public() @HttpCode(204)
  @Post('logout')
  async logout(@Body(new ZodPipe(RefreshDto)) body: z.infer<typeof RefreshDto>) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
