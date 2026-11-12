# MediConsult

**Secure online doctor consultations, by [Fascinora](https://github.com/fascEarth).**
Patients find verified doctors, book a slot in their own timezone, pay, and meet over encrypted video. They get an e-prescription and can follow up by chat. Doctors manage their schedule, notes and prescriptions. Admins verify medical registrations.

## Features

| | |
|---|---|
| **Patients** | Search by specialty, language or name · real-time slot picker in local timezone · telemedicine consent · secure payment · video consultation in the browser · encrypted chat · e-prescription (print/PDF) · health profile · upload reports (PDF/JPG/PNG) and share per visit · reviews · data export and deletion request |
| **Doctors** | Apply with council registration · weekly availability and time off · daily schedule · SOAP clinical notes · e-prescription builder · complete / no-show · follow-up chat for 7 days |
| **Admin** | Verify or suspend doctors · platform stats · audit log of every PHI access |
| **Payments** | Pluggable provider: `demo` (no money moves) or Razorpay (orders + HMAC signature verification + refunds) |
| **Video** | Jitsi Meet embedded. Unguessable room ids are issued by the API only to participants, only in the join window (10 min before → 30 min after). Recording disabled. Self-host Jitsi with JWT for production. |

## Security and compliance design

- **Encryption at rest for PHI.** Clinical notes, prescriptions, chat, medical summary and uploaded files use AES-256-GCM with a fresh IV per value (`DATA_ENCRYPTION_KEY`).
- **Access control.** Role guards (patient/doctor/admin) plus participant checks on every appointment resource. Doctors see only reports shared with their own consultations. Admins never see clinical content.
- **Audit trail.** Every PHI read/write, login, payment and admin action is logged. The `audit_logs` table is append-only (DB trigger).
- **Auth.** argon2id passwords (10+ chars, mixed). 15-minute access JWTs with rotating refresh tokens; reuse detection revokes all of the user's sessions. Account lockout after 5 failed attempts. Rate limits on auth.
- **Double-booking prevention.** Partial unique index on `(doctorId, startsAt)` for live appointments, plus unpaid holds that expire after 10 minutes.
- **Uploads.** Type is checked by magic bytes, files are capped at 10 MB, stored with random keys, encrypted, and served with `no-store` and `nosniff`.
- **Web.** Helmet, strict CORS, session stored in `sessionStorage` (cleared when the tab closes), and no PHI in emails.
- **Designed with these frameworks in mind:** India Telemedicine Practice Guidelines 2020, DPDP Act 2023, GDPR, and HIPAA-style safeguards. Legal texts in `/legal/*` are templates that need legal review before production.

## Quick start

```bash
npm install
npm run infra:up                     # Postgres :5433, Mailpit :8026
cp .env.example api/.env             # then set DATA_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm run db:migrate                   # migrations + constraints.sql
npm run db:seed
npm run dev:api                      # http://localhost:3100/api/v1
npm run dev:web                      # http://localhost:4300
```

| Demo account | Password |
|---|---|
| patient@mediconsult.demo | Patient@12345 |
| doctor@mediconsult.demo | Doctor@12345 |
| admin@mediconsult.demo | Admin@12345 |

Demo flow: sign in as the patient, pick Dr. Kavya Raman, choose a slot and pay (demo). Then sign in as the doctor in another browser. Both can join from 10 minutes before the start. The doctor writes notes, issues a prescription and completes the visit, and the patient prints the prescription and leaves a review.

## Public demo deployment checklist

1. `DEMO_MODE=true`, `PAYMENT_PROVIDER=demo` (the API refuses demo mode with a real provider in production).
2. HTTPS only. Set `CORS_ORIGINS` and `APP_URL` to the demo domain.
3. Nightly reset: `prisma migrate reset --force && npm run db:seed` on a cron, so visitors never leave real data.
4. Keep the rate limits. Put the API behind Cloudflare or a similar WAF.
5. Configure web `index.html` with `window.__MEDICONSULT__ = { apiUrl, wsUrl }`.

Suggested hosting: web on Vercel, Netlify or Cloudflare Pages. API on Render, Railway or Fly.io. Postgres on Neon or Supabase. Uploads should move to S3/R2 for multi-instance deployments.

## Project layout

```
api/   NestJS 11 · Prisma 6 · PostgreSQL · Socket.IO (chat)
  src/auth          register (patient/doctor), login, refresh rotation, guards
  src/doctors       search, profiles, timezone-aware slot engine (luxon)
  src/appointments  booking, holds, payments, join window, notes, prescriptions, chat, reviews, reminders
  src/patients      health profile, encrypted records, export, deletion request
  src/admin         doctor verification, stats, audit
  src/payments      demo + Razorpay providers
web/   Angular 20 standalone app (signals, lazy routes, responsive, print-ready prescription)
```

## Roadmap
SMS/WhatsApp reminders · Stripe for international payments · self-hosted Jitsi with JWT · ABDM/ABHA integration (India) · FHIR export · lab and pharmacy partners · doctor payouts · multi-clinic tenancy on Nexus Core.

© Fascinora. All rights reserved.
