import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: Role;
  sid: string;
  ip?: string;
}

export const IS_PUBLIC = 'mc:public';
export const ROLES = 'mc:roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException();
    }
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; role: Role; sid: string }>(token, { secret: process.env.JWT_ACCESS_SECRET });
      req.user = { id: claims.sub, role: claims.role, sid: claims.sid, ip: req.ip };
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Session expired');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException();
    return true;
  }
}
