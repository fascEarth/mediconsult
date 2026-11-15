/**
 * Demo data. All people are fictional.
 *   admin@mediconsult.demo   / Admin@12345
 *   patient@mediconsult.demo / Patient@12345
 *   doctor@mediconsult.demo  / Doctor@12345   (Dr. Kavya Raman, General Physician)
 */
import { AppointmentStatus, PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();
const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });

const doctors = [
  { email: 'doctor@mediconsult.demo', first: 'Kavya', last: 'Raman', specialty: 'General Physician', q: 'MBBS, MD (Internal Medicine)', exp: 11, langs: ['English', 'Tamil', 'Hindi'], fee: 49900, bio: 'Primary care for fever, infections, diabetes and blood pressure follow-ups.' },
  { email: 'arjun.mehta@mediconsult.demo', first: 'Arjun', last: 'Mehta', specialty: 'Dermatology', q: 'MBBS, MD (Dermatology)', exp: 9, langs: ['English', 'Hindi', 'Gujarati'], fee: 69900, bio: 'Acne, eczema, hair loss and skin allergies.' },
  { email: 'sara.thomas@mediconsult.demo', first: 'Sara', last: 'Thomas', specialty: 'Paediatrics', q: 'MBBS, DCH, MD (Paediatrics)', exp: 14, langs: ['English', 'Malayalam', 'Tamil'], fee: 59900, bio: 'Child health, vaccinations, growth and nutrition.' },
  { email: 'imran.khan@mediconsult.demo', first: 'Imran', last: 'Khan', specialty: 'Cardiology', q: 'MBBS, MD, DM (Cardiology)', exp: 18, langs: ['English', 'Hindi', 'Urdu'], fee: 99900, bio: 'Heart health, hypertension and post-procedure follow-ups.' },
  { email: 'meera.iyer@mediconsult.demo', first: 'Meera', last: 'Iyer', specialty: 'Psychiatry', q: 'MBBS, MD (Psychiatry)', exp: 10, langs: ['English', 'Tamil', 'Kannada'], fee: 89900, bio: 'Anxiety, depression, sleep and stress management.' },
  { email: 'li.wei@mediconsult.demo', first: 'Li', last: 'Wei', specialty: 'Gynaecology', q: 'MBBS, MS (Obstetrics & Gynaecology)', exp: 12, langs: ['English', 'Mandarin'], fee: 79900, bio: "Women's health, pregnancy care and PCOS." },
];

async function upsertUser(email: string, password: string, role: Role, firstName: string, lastName: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await hash(password), role, firstName, lastName } });
}

async function main() {
  await upsertUser('admin@mediconsult.demo', 'Admin@12345', 'ADMIN', 'Platform', 'Admin');

  const patient = await upsertUser('patient@mediconsult.demo', 'Patient@12345', 'PATIENT', 'Ravi', 'Kumar');
  await prisma.patientProfile.upsert({ where: { userId: patient.id }, update: {}, create: { userId: patient.id, gender: 'male', bloodGroup: 'O+', dateOfBirth: new Date('1990-04-12') } });

  for (const d of doctors) {
    const u = await upsertUser(d.email, 'Doctor@12345', 'DOCTOR', d.first, d.last);
    await prisma.doctorProfile.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id, status: 'VERIFIED', verifiedAt: new Date(), specialty: d.specialty, qualifications: d.q,
        registrationNumber: `DEMO-${Math.floor(10000 + Math.random() * 89999)}`, registrationCouncil: 'Demo Medical Council',
        experienceYears: d.exp, languages: d.langs, feeMinor: d.fee, bio: d.bio, slotMinutes: 15,
        ratingAvg: 4.5 + Math.random() * 0.5, ratingCount: 20 + Math.floor(Math.random() * 200),
      },
    });
    if (!(await prisma.availabilityRule.count({ where: { doctorId: u.id } }))) {
      // Demo: open every day, morning and evening blocks, so a demo always has slots.
      const rules = [];
      for (let weekday = 1; weekday <= 7; weekday++) {
        rules.push({ doctorId: u.id, weekday, startTime: '08:00', endTime: '13:00' });
        rules.push({ doctorId: u.id, weekday, startTime: '15:00', endTime: '22:00' });
      }
      await prisma.availabilityRule.createMany({ data: rules });
    }
  }

  const pending = await upsertUser('new.doctor@mediconsult.demo', 'Doctor@12345', 'DOCTOR', 'Nikhil', 'Rao');
  await prisma.doctorProfile.upsert({
    where: { userId: pending.id }, update: {},
    create: { userId: pending.id, status: 'PENDING', specialty: 'Orthopaedics', qualifications: 'MBBS, MS (Ortho)', registrationNumber: 'DEMO-55555', registrationCouncil: 'Demo Medical Council', experienceYears: 6, languages: ['English', 'Telugu'], feeMinor: 59900 },
  });

  await seedHistory(patient.id);
  console.log('Seeded MediConsult demo data. Patient: patient@mediconsult.demo / Patient@12345');
}

// ─────────────── Demo history: ~12 weeks of fictional activity so dashboards have data ───────────────

/** Same format as CryptoService (v1.<iv>.<tag>.<data>), so the API can decrypt seeded PHI. */
function encryptJson(value: unknown): string {
  const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Deterministic PRNG so every reset produces the same-looking demo. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Aditya', 'Kavya', 'Nikhil', 'Pooja', 'Rahul', 'Sneha', 'Varun', 'Nisha', 'Karthik', 'Divya', 'Farhan', 'Lakshmi', 'Siddharth', 'Zara'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Menon', 'Das', 'Pillai', 'Joshi', 'Bose', 'Khan', 'Rao', 'Patel', 'Singh', 'Varma', 'Chopra'];
const REASONS: Record<string, string[]> = {
  'General Physician': ['Fever and body ache for 3 days', 'Follow-up for blood pressure', 'Persistent cough', 'Diabetes review', 'Stomach upset'],
  Dermatology: ['Acne flare-up', 'Itchy rash on arms', 'Hair fall', 'Eczema follow-up'],
  Paediatrics: ['Child has a cold and mild fever', 'Vaccination schedule question', 'Growth and diet review'],
  Cardiology: ['Chest discomfort on exertion', 'Hypertension follow-up', 'Palpitations'],
  Psychiatry: ['Trouble sleeping', 'Anxiety at work', 'Follow-up on medication'],
  Gynaecology: ['Irregular cycles', 'PCOS follow-up', 'Pregnancy check-in'],
};
const COMMENTS = [
  'Very patient and explained everything clearly.', 'Quick diagnosis and the prescription worked.', 'Felt heard. Would consult again.',
  'Good advice, video was clear.', 'Helpful follow-up, thank you doctor.', 'Explained the reports in simple words.', null, null,
];

async function seedHistory(mainPatientId: string) {
  if (await prisma.appointment.count({ where: { status: 'COMPLETED' } })) return; // already seeded
  const rand = rng(20261115);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const tz = 'Asia/Kolkata';
  const now = DateTime.now().setZone(tz);
  const pwHash = await hash('Patient@12345');

  // Fictional patients
  const patientIds = [mainPatientId];
  for (let i = 0; i < 24; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const email = `${first}.${last}.${i}@patients.mediconsult.demo`.toLowerCase();
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: pwHash, role: 'PATIENT', firstName: first, lastName: last } });
    await prisma.patientProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
    patientIds.push(u.id);
  }

  const docs = await prisma.doctorProfile.findMany({ where: { status: 'VERIFIED' }, include: { user: true } });
  const used = new Set<string>();
  let refN = 0;
  const reference = (d: DateTime) => `MC-${d.toFormat('yyMMdd')}-${(0xa00000 + refN++ * 7919).toString(16).toUpperCase().slice(-6)}`;
  const slotKey = (doctorId: string, t: DateTime) => `${doctorId}|${t.toISO()}`;
  const freeSlot = (doctorId: string, day: DateTime, hours: number[]) => {
    for (let tries = 0; tries < 30; tries++) {
      const h = pick(hours);
      const t = day.set({ hour: h, minute: pick([0, 15, 30, 45]), second: 0, millisecond: 0 });
      if (!used.has(slotKey(doctorId, t))) { used.add(slotKey(doctorId, t)); return t; }
    }
    return null;
  };
  const HOURS = [8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21];

  type Row = { doctorId: string; patientId: string; start: DateTime; status: AppointmentStatus; specialty: string; feeMinor: number };
  const rows: Row[] = [];
  for (const d of docs) {
    const busy = d.user.email === 'doctor@mediconsult.demo' ? 1.6 : 0.6 + rand() * 0.8;
    for (let back = 84; back >= 1; back--) {
      const day = now.minus({ days: back }).startOf('day');
      const n = Math.round((day.weekday >= 6 ? 0.6 : 1.2) * busy * (0.5 + rand()));
      for (let k = 0; k < n; k++) {
        const start = freeSlot(d.userId, day, HOURS);
        if (!start) continue;
        const r = rand();
        const status: AppointmentStatus = r < 0.84 ? 'COMPLETED' : r < 0.9 ? 'NO_SHOW' : 'CANCELLED';
        let patientId = rand() < 0.35 ? pick(patientIds.slice(1, 9)) : pick(patientIds.slice(1));
        for (let t = 0; t < 10 && used.has(`p|${patientId}|${start.toISO()}`); t++) patientId = pick(patientIds.slice(1));
        if (used.has(`p|${patientId}|${start.toISO()}`)) continue;
        used.add(`p|${patientId}|${start.toISO()}`);
        rows.push({ doctorId: d.userId, patientId, start, status, specialty: d.specialty, feeMinor: d.feeMinor });
      }
    }
    // Today and the next 6 days
    for (let fwd = 0; fwd <= 6; fwd++) {
      const day = now.plus({ days: fwd }).startOf('day');
      const n = fwd === 0 && d.user.email === 'doctor@mediconsult.demo' ? 5 : Math.round(rand() * 2 * busy);
      for (let k = 0; k < n; k++) {
        const start = freeSlot(d.userId, day, HOURS);
        if (!start) continue;
        const status: AppointmentStatus = start < now.minus({ minutes: 30 }) ? 'COMPLETED' : 'CONFIRMED';
        const patientId = pick(patientIds.slice(1));
        if (used.has(`p|${patientId}|${start.toISO()}`)) continue;
        used.add(`p|${patientId}|${start.toISO()}`);
        rows.push({ doctorId: d.userId, patientId, start, status, specialty: d.specialty, feeMinor: d.feeMinor });
      }
    }
  }

  // The main demo patient: a few past consultations with prescriptions, and one coming up tomorrow.
  const kavya = docs.find((d) => d.user.email === 'doctor@mediconsult.demo');
  const mainHistory: { doc: (typeof docs)[number]; daysAgo: number; rx: object }[] = [];
  const byEmail = (e: string) => docs.find((d) => d.user.email === e);
  const plan: [string | undefined, number, object][] = [
    ['doctor@mediconsult.demo', 62, { diagnosis: 'Viral fever', items: [{ medicine: 'Paracetamol 650 mg', dosage: '1 tablet', frequency: 'Every 8 hours if fever', duration: '5 days' }], advice: 'Fluids and rest.', followUpDays: 7 }],
    ['imran.khan@mediconsult.demo', 40, { diagnosis: 'Stage 1 hypertension', items: [{ medicine: 'Amlodipine 5 mg', dosage: '1 tablet', frequency: 'Once daily, morning', duration: 'Ongoing' }], advice: 'Reduce salt, walk 30 minutes daily, log BP twice a week.', followUpDays: 30 }],
    ['arjun.mehta@mediconsult.demo', 21, { diagnosis: 'Contact dermatitis', items: [{ medicine: 'Mometasone cream 0.1%', dosage: 'Thin layer', frequency: 'Twice daily', duration: '2 weeks' }, { medicine: 'Cetirizine 10 mg', dosage: '1 tablet', frequency: 'At night', duration: '10 days' }] }],
    ['doctor@mediconsult.demo', 6, { diagnosis: 'Vitamin D deficiency', items: [{ medicine: 'Cholecalciferol 60,000 IU', dosage: '1 sachet', frequency: 'Once weekly', duration: '8 weeks' }], advice: 'Morning sunlight 15 minutes.', followUpDays: 60 }],
  ];
  for (const [email, daysAgo, rx] of plan) {
    const doc = email ? byEmail(email) : undefined;
    if (doc) mainHistory.push({ doc, daysAgo, rx });
  }

  const createdIds: { id: string; row: Row }[] = [];
  for (const r of rows) {
    if (await prisma.appointment.count({ where: { doctorId: r.doctorId, startsAt: r.start.toJSDate() } })) continue; // slot taken by real data
    const createdAt = r.start.minus({ days: Math.floor(rand() * 5), hours: Math.floor(rand() * 10) });
    const startsAt = r.start.toJSDate();
    const endsAt = r.start.plus({ minutes: 15 }).toJSDate();
    const a = await prisma.appointment.create({
      data: {
        reference: reference(r.start), patientId: r.patientId, doctorId: r.doctorId, startsAt, endsAt, status: r.status,
        reason: pick(REASONS[r.specialty] ?? ['Consultation']), feeMinor: r.feeMinor, currency: 'INR',
        consentVersion: '2026-11-v1', consentAt: createdAt.toJSDate(), createdAt: createdAt.toJSDate(),
        roomName: r.status === 'CONFIRMED' ? `mc-${randomBytes(16).toString('hex')}` : null,
        completedAt: r.status === 'COMPLETED' ? endsAt : null,
        doctorJoinedAt: r.status === 'COMPLETED' ? startsAt : null, patientJoinedAt: r.status === 'COMPLETED' ? startsAt : null,
        cancelledBy: r.status === 'CANCELLED' ? (rand() < 0.7 ? 'PATIENT' : 'DOCTOR') : null,
      },
    });
    createdIds.push({ id: a.id, row: r });
    if (r.status !== 'CANCELLED' || rand() < 0.6) {
      await prisma.payment.create({
        data: {
          appointmentId: a.id, provider: 'demo', orderId: `demo_order_${a.id}`, paymentId: `demo_pay_${a.id}`, amountMinor: r.feeMinor, currency: 'INR',
          status: r.status === 'CANCELLED' ? 'REFUNDED' : 'SUCCEEDED', createdAt: createdAt.plus({ minutes: 3 }).toJSDate(),
        },
      });
    }
  }

  // Reviews (about 60% of completed consultations), then recompute doctor ratings.
  for (const { id, row } of createdIds) {
    if (row.status !== 'COMPLETED' || rand() > 0.6) continue;
    const x = rand();
    const rating = x < 0.62 ? 5 : x < 0.9 ? 4 : x < 0.97 ? 3 : x < 0.99 ? 2 : 1;
    await prisma.review.create({ data: { appointmentId: id, doctorId: row.doctorId, rating, comment: rating >= 4 ? pick(COMMENTS) : 'Call dropped once but the advice was fine.', createdAt: row.start.plus({ hours: 2 }).toJSDate() } });
  }

  // Main patient's own history with prescriptions.
  for (const h of mainHistory) {
    const day = now.minus({ days: h.daysAgo }).startOf('day');
    const start = freeSlot(h.doc.userId, day, [10, 11, 17, 18]);
    if (!start) continue;
    const a = await prisma.appointment.create({
      data: {
        reference: reference(start), patientId: mainPatientId, doctorId: h.doc.userId, startsAt: start.toJSDate(), endsAt: start.plus({ minutes: 15 }).toJSDate(),
        status: 'COMPLETED', reason: pick(REASONS[h.doc.specialty] ?? ['Consultation']), feeMinor: h.doc.feeMinor, currency: 'INR',
        consentVersion: '2026-11-v1', consentAt: start.minus({ days: 1 }).toJSDate(), createdAt: start.minus({ days: 1 }).toJSDate(),
        completedAt: start.plus({ minutes: 15 }).toJSDate(), doctorJoinedAt: start.toJSDate(), patientJoinedAt: start.toJSDate(),
      },
    });
    await prisma.payment.create({ data: { appointmentId: a.id, provider: 'demo', orderId: `demo_order_${a.id}`, paymentId: `demo_pay_${a.id}`, amountMinor: h.doc.feeMinor, currency: 'INR', status: 'SUCCEEDED', createdAt: start.minus({ days: 1 }).toJSDate() } });
    await prisma.prescription.create({ data: { appointmentId: a.id, dataEnc: encryptJson(h.rx), issuedAt: start.plus({ minutes: 14 }).toJSDate() } });
    if (h.daysAgo > 10) await prisma.review.create({ data: { appointmentId: a.id, doctorId: h.doc.userId, rating: 5, comment: pick(COMMENTS.filter(Boolean) as string[]), createdAt: start.plus({ hours: 3 }).toJSDate() } });
  }
  if (kavya) {
    const start = freeSlot(kavya.userId, now.plus({ days: 1 }).startOf('day'), [10, 11]);
    if (start) {
      const a = await prisma.appointment.create({
        data: {
          reference: reference(start), patientId: mainPatientId, doctorId: kavya.userId, startsAt: start.toJSDate(), endsAt: start.plus({ minutes: 15 }).toJSDate(),
          status: 'CONFIRMED', reason: 'Follow-up on vitamin D and BP readings', feeMinor: kavya.feeMinor, currency: 'INR',
          consentVersion: '2026-11-v1', consentAt: now.toJSDate(), roomName: `mc-${randomBytes(16).toString('hex')}`,
        },
      });
      await prisma.payment.create({ data: { appointmentId: a.id, provider: 'demo', orderId: `demo_order_${a.id}`, paymentId: `demo_pay_${a.id}`, amountMinor: kavya.feeMinor, currency: 'INR', status: 'SUCCEEDED' } });
      await prisma.notification.createMany({
        data: [
          { userId: mainPatientId, type: 'appointment.confirmed', title: 'Consultation confirmed', body: `With Dr. Kavya Raman · ${a.reference}`, link: `/appointments/${a.id}` },
          { userId: kavya.userId, type: 'appointment.booked', title: 'New consultation booked', body: `Ravi Kumar · ${a.reference}`, link: `/appointments/${a.id}` },
        ],
      });
    }
  }

  for (const d of docs) {
    const agg = await prisma.review.aggregate({ where: { doctorId: d.userId }, _avg: { rating: true }, _count: true });
    if (agg._count) await prisma.doctorProfile.update({ where: { userId: d.userId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
  }

  // Main patient's vitals: BP slowly improving after starting medication, weekly weight and fasting glucose.
  const vitals: { type: string; value: object; at: DateTime }[] = [];
  for (let back = 84; back >= 0; back -= 3) {
    const at = now.minus({ days: back }).set({ hour: 8, minute: Math.floor(rand() * 50) });
    const improve = back < 40 ? (40 - back) * 0.35 : 0;
    vitals.push({ type: 'BP', value: { systolic: Math.round(146 - improve + (rand() - 0.5) * 8), diastolic: Math.round(93 - improve * 0.5 + (rand() - 0.5) * 6) }, at });
    vitals.push({ type: 'HR', value: { bpm: Math.round(78 - improve * 0.2 + (rand() - 0.5) * 8) }, at });
    if (back % 7 === 0) {
      vitals.push({ type: 'WEIGHT', value: { kg: Math.round((82.5 - (84 - back) * 0.03 + (rand() - 0.5) * 0.6) * 10) / 10 }, at });
      vitals.push({ type: 'GLUCOSE', value: { mgdl: Math.round(104 + (rand() - 0.5) * 14), context: 'fasting' }, at });
      vitals.push({ type: 'SPO2', value: { percent: 97 + Math.floor(rand() * 3) }, at });
    }
  }
  vitals.push({ type: 'TEMP', value: { celsius: 38.6 }, at: now.minus({ days: 63 }) });
  vitals.push({ type: 'TEMP', value: { celsius: 36.8 }, at: now.minus({ days: 58 }) });
  await prisma.vital.createMany({ data: vitals.map((v) => ({ patientId: mainPatientId, type: v.type, valueEnc: encryptJson(v.value), recordedAt: v.at.toJSDate() })) });

  await prisma.notification.createMany({
    data: [
      { userId: mainPatientId, type: 'prescription.issued', title: 'Prescription ready', body: 'From your consultation with Dr. Kavya Raman', link: '/health', createdAt: now.minus({ days: 6 }).toJSDate(), readAt: now.minus({ days: 6 }).toJSDate() },
      { userId: mainPatientId, type: 'tip', title: 'Log your blood pressure', body: 'Dr. Imran Khan asked for readings twice a week', link: '/health', createdAt: now.minus({ hours: 20 }).toJSDate() },
    ],
  });
  console.log(`Seeded demo history: ${rows.length + mainHistory.length + 1} consultations, ${vitals.length} vitals`);
}

main().finally(() => prisma.$disconnect());
