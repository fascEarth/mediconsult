/**
 * Boot smoke test: the whole Nest app must construct (dependency injection, decorators,
 * module wiring) and expose its routes. Catches start-up crashes before they reach a server.
 * Prisma connects lazily, so no database is needed for this test.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

process.env.DATABASE_URL ??= 'postgresql://boot:test@127.0.0.1:1/boot';
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);
process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.SMTP_HOST ??= '127.0.0.1';

// Wiring only: replace the database client so no engine or database is needed.
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  class PrismaClient {
    $connect() { return Promise.resolve(); }
    $disconnect() { return Promise.resolve(); }
  }
  return { ...actual, PrismaClient };
});

describe('API boot', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const { AppModule } = await import('./app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    const addr = app.getHttpServer().address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves public config without a database', async () => {
    const r = await fetch(`${base}/config`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ consentVersion: expect.any(String) });
  });

  it.each([
    ['GET', '/me/notifications'],
    ['GET', '/me/vitals'],
    ['GET', '/me/medications'],
    ['GET', '/me/health-summary'],
    ['GET', '/doctors/me/insights'],
    ['GET', '/admin/analytics'],
    ['GET', '/admin/appointments'],
    ['GET', '/appointments/x/vitals'],
  ])('%s %s is registered and requires sign-in', async (method, path) => {
    const r = await fetch(`${base}${path}`, { method });
    expect(r.status).toBe(401);
  });

  it('returns 404 for unknown routes', async () => {
    const r = await fetch(`${base}/definitely-not-a-route`);
    expect(r.status).toBe(404);
  });
});
