# MediConsult — rules for Claude Code

Health data app. Treat every change as security-sensitive.

- PHI (notes, prescriptions, chat, medical summary, files) is ALWAYS stored via `CryptoService` and never logged, emailed or returned to ADMIN.
- Every appointment-scoped endpoint loads through `AppointmentsService.forParticipant()`; doctor-only actions through `asDoctor()`.
- Every PHI read/write calls `AuditService.log`.
- Validate input with zod (`ZodPipe`). Money is in minor units (paise/cents) as integers.
- Times are stored in UTC; slot rules are in the doctor's timezone (luxon). Add a test for any slot logic change.
- Web: standalone components, signals, `@if/@for`; never store tokens in localStorage.
- Done = `cd api && npx tsc --noEmit && npx jest` and `cd web && npx ng build` pass.
