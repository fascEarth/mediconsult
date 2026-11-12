import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

function assertEnv() {
  const missing = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'DATA_ENCRYPTION_KEY'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
  if ((process.env.JWT_ACCESS_SECRET ?? '').length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true' && process.env.PAYMENT_PROVIDER !== 'demo') {
    throw new Error('DEMO_MODE with a real payment provider is not allowed');
  }
}

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4300').split(','), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  Logger.log(`MediConsult API on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
