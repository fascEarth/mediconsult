/**
 * In-browser simulation of the MediConsult API for public demos.
 * All data is fictional and lives only in this visitor's browser (localStorage).
 * Chat between a patient tab and a doctor tab is relayed over BroadcastChannel.
 */
import { HttpErrorResponse, HttpEvent, HttpRequest, HttpResponse } from '@angular/common/http';
import { catchError, delay, from, Observable, of, switchMap, throwError } from 'rxjs';

type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
type Status = 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';

interface User { id: string; email: string; password: string; role: Role; firstName: string; lastName: string; phone?: string; timezone: string }
interface Doctor {
  userId: string; status: 'PENDING' | 'VERIFIED' | 'SUSPENDED'; specialty: string; qualifications: string; registrationNumber: string; registrationCouncil: string;
  experienceYears: number; languages: string[]; bio?: string; feeMinor: number; currency: string; slotMinutes: number; ratingAvg: number; ratingCount: number;
  availability: { weekday: number; startTime: string; endTime: string }[]; timeOff: { id: string; startsAt: string; endsAt: string; reason?: string }[]; createdAt: string;
}
interface Appt {
  id: string; reference: string; patientId: string; doctorId: string; startsAt: string; endsAt: string; status: Status; reason: string;
  holdExpiresAt?: string | null; feeMinor: number; currency: string; recordIds: string[]; completedAt?: string; patientJoinedAt?: string;
  notes?: Record<string, string>; prescription?: Record<string, unknown> & { issuedAt: string }; review?: { rating: number; comment?: string; createdAt: string };
}
interface Msg { id: string; appointmentId: string; senderId: string; body: string; createdAt: string }
interface Rec { id: string; patientId: string; title: string; fileName: string; mimeType: string; sizeBytes: number; dataUrl: string; createdAt: string }
interface Profile { dateOfBirth?: string; gender?: string; bloodGroup?: string; emergencyContact?: string; medicalSummary: { allergies: string; conditions: string; medications: string } }
interface Notif { id: string; userId: string; type: string; title: string; body: string; link?: string; readAt?: string | null; createdAt: string }
interface DVital { id: string; patientId: string; type: string; value: Record<string, number | string>; recordedAt: string }
interface Db { v: number; users: User[]; doctors: Doctor[]; appts: Appt[]; messages: Msg[]; records: Rec[]; profiles: Record<string, Profile>; notifications?: Notif[]; vitals?: DVital[]; audit?: AuditRow[] }
interface AuditRow { id: string; actorId: string; actorRole: string; action: string; entity: string; entityId: string; createdAt: string }

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const KEY = 'mediconsult.demo.db.v1';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const iso = (d: Date) => d.toISOString();
const ref = () => `MC-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

function seed(): Db {
  const users: User[] = [
    { id: 'u-admin', email: 'admin@mediconsult.demo', password: 'Admin@12345', role: 'ADMIN', firstName: 'Platform', lastName: 'Admin', timezone: TZ },
    { id: 'u-pat', email: 'patient@mediconsult.demo', password: 'Patient@12345', role: 'PATIENT', firstName: 'Ravi', lastName: 'Kumar', phone: '+91 98765 43210', timezone: TZ },
  ];
  const docs: [string, string, string, string, string, number, string[], number, string, number, number][] = [
    ['d-kavya', 'doctor@mediconsult.demo', 'Kavya', 'Raman', 'General Physician', 11, ['English', 'Tamil', 'Hindi'], 49900, 'MBBS, MD (Internal Medicine)', 4.8, 124],
    ['d-arjun', 'arjun.mehta@mediconsult.demo', 'Arjun', 'Mehta', 'Dermatology', 9, ['English', 'Hindi', 'Gujarati'], 69900, 'MBBS, MD (Dermatology)', 4.6, 88],
    ['d-sara', 'sara.thomas@mediconsult.demo', 'Sara', 'Thomas', 'Paediatrics', 14, ['English', 'Malayalam', 'Tamil'], 59900, 'MBBS, DCH, MD (Paediatrics)', 4.9, 210],
    ['d-imran', 'imran.khan@mediconsult.demo', 'Imran', 'Khan', 'Cardiology', 18, ['English', 'Hindi', 'Urdu'], 99900, 'MBBS, MD, DM (Cardiology)', 4.7, 156],
    ['d-meera', 'meera.iyer@mediconsult.demo', 'Meera', 'Iyer', 'Psychiatry', 10, ['English', 'Tamil', 'Kannada'], 89900, 'MBBS, MD (Psychiatry)', 4.8, 97],
    ['d-li', 'li.wei@mediconsult.demo', 'Li', 'Wei', 'Gynaecology', 12, ['English', 'Mandarin'], 79900, 'MBBS, MS (Obstetrics & Gynaecology)', 4.7, 64],
  ];
  const bios: Record<string, string> = {
    'General Physician': 'Primary care for fever, infections, diabetes and blood pressure follow-ups.',
    Dermatology: 'Acne, eczema, hair loss and skin allergies.',
    Paediatrics: 'Child health, vaccinations, growth and nutrition.',
    Cardiology: 'Heart health, hypertension and post-procedure follow-ups.',
    Psychiatry: 'Anxiety, depression, sleep and stress management.',
    Gynaecology: "Women's health, pregnancy care and PCOS.",
  };
  const availability = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
    { weekday, startTime: '00:00', endTime: '23:45' },
  ]);
  const doctors: Doctor[] = [];
  for (const [id, email, first, last, specialty, exp, langs, fee, q, rating, count] of docs) {
    users.push({ id, email, password: 'Doctor@12345', role: 'DOCTOR', firstName: first, lastName: last, timezone: TZ });
    doctors.push({
      userId: id, status: 'VERIFIED', specialty, qualifications: q, registrationNumber: `DEMO-${10000 + doctors.length * 1234}`, registrationCouncil: 'Demo Medical Council',
      experienceYears: exp, languages: langs, bio: bios[specialty], feeMinor: fee, currency: 'INR', slotMinutes: 15, ratingAvg: rating, ratingCount: count,
      availability, timeOff: [], createdAt: iso(new Date(Date.now() - 90 * 86_400_000)),
    });
  }
  users.push({ id: 'd-nikhil', email: 'new.doctor@mediconsult.demo', password: 'Doctor@12345', role: 'DOCTOR', firstName: 'Nikhil', lastName: 'Rao', timezone: TZ });
  doctors.push({ userId: 'd-nikhil', status: 'PENDING', specialty: 'Orthopaedics', qualifications: 'MBBS, MS (Ortho)', registrationNumber: 'DEMO-55555', registrationCouncil: 'Demo Medical Council',
    experienceYears: 6, languages: ['English', 'Telugu'], feeMinor: 59900, currency: 'INR', slotMinutes: 15, ratingAvg: 0, ratingCount: 0, availability: [], timeOff: [], createdAt: iso(new Date()) });

  // A past consultation with a prescription, and one confirmed for "now" so the room can be tried immediately.
  const past = new Date(Date.now() - 6 * 86_400_000);
  past.setMinutes(0, 0, 0);
  const soon = new Date(Date.now() + 5 * 60_000);
  soon.setSeconds(0, 0);
  const appts: Appt[] = [
    { id: 'a-past', reference: 'MC-DEMO-PAST01', patientId: 'u-pat', doctorId: 'd-kavya', startsAt: iso(past), endsAt: iso(new Date(past.getTime() + 15 * 60_000)), status: 'COMPLETED',
      reason: 'Fever and sore throat for 3 days', feeMinor: 49900, currency: 'INR', recordIds: [], completedAt: iso(new Date(past.getTime() + 20 * 60_000)),
      notes: { subjective: 'Fever 101°F x3 days, sore throat', objective: 'Mild pharyngeal redness (patient-reported)', assessment: 'Acute viral pharyngitis', plan: 'Symptomatic care, review if > 5 days' },
      prescription: { issuedAt: iso(new Date(past.getTime() + 18 * 60_000)), diagnosis: 'Acute viral pharyngitis', items: [
        { medicine: 'Paracetamol 500 mg', dosage: '1 tablet', frequency: '1-1-1 (if fever)', duration: '3 days', instructions: 'After food' },
        { medicine: 'Warm saline gargle', dosage: '—', frequency: '3 times a day', duration: '5 days', instructions: '' },
      ], advice: 'Plenty of fluids and rest. Return if breathing difficulty or fever beyond 5 days.', followUpDays: 5 } },
    { id: 'a-now', reference: 'MC-DEMO-NOW001', patientId: 'u-pat', doctorId: 'd-kavya', startsAt: iso(soon), endsAt: iso(new Date(soon.getTime() + 15 * 60_000)), status: 'CONFIRMED',
      reason: 'Follow-up: blood pressure readings', feeMinor: 49900, currency: 'INR', recordIds: [] },
  ];
  const messages: Msg[] = [
    { id: uid(), appointmentId: 'a-past', senderId: 'd-kavya', body: 'How are you feeling today, Ravi?', createdAt: iso(new Date(past.getTime() + 2 * 86_400_000)) },
    { id: uid(), appointmentId: 'a-past', senderId: 'u-pat', body: 'Much better, fever is gone. Thank you doctor!', createdAt: iso(new Date(past.getTime() + 2 * 86_400_000 + 600_000)) },
  ];
  const extra = history(users, doctors, appts);
  return { v: 1, users, doctors, appts, messages, records: [], notifications: extra.notifications, vitals: extra.vitals, audit: [], profiles: { 'u-pat': { gender: 'male', bloodGroup: 'O+', dateOfBirth: '1990-04-12', medicalSummary: { allergies: 'None known', conditions: 'Mild hypertension', medications: 'Telmisartan 40 mg once daily' } } } };
}

/** ~10 weeks of fictional activity so dashboards and charts have something to show. */
function history(users: User[], doctors: Doctor[], appts: Appt[]) {
  let seed = 20261115;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const names = [['Aarav', 'Sharma'], ['Diya', 'Iyer'], ['Vihaan', 'Reddy'], ['Ananya', 'Nair'], ['Kabir', 'Gupta'], ['Meera', 'Menon'], ['Rohan', 'Das'], ['Saanvi', 'Pillai'], ['Aditya', 'Joshi'], ['Pooja', 'Bose'], ['Farhan', 'Khan'], ['Lakshmi', 'Rao']];
  const pids = names.map(([f, l], i) => {
    const id = `u-p${i}`;
    users.push({ id, email: `${f}.${l}@patients.mediconsult.demo`.toLowerCase(), password: 'Patient@12345', role: 'PATIENT', firstName: f, lastName: l, timezone: TZ });
    return id;
  });
  const comments = ['Very patient and explained everything clearly.', 'Quick diagnosis and the prescription worked.', 'Felt heard. Would consult again.', 'Good advice, video was clear.', undefined];
  const used = new Set(appts.map((a) => `${a.doctorId}|${a.startsAt}`));
  const hours = [9, 10, 11, 12, 16, 17, 18, 19, 20];
  const now = Date.now();
  for (const d of doctors.filter((x) => x.status === 'VERIFIED')) {
    const busy = d.userId === 'd-kavya' ? 1.5 : 0.7;
    for (let back = 70; back >= -5; back--) {
      if (back === 0) continue;
      const n = Math.round(busy * (0.4 + rand() * 1.4));
      for (let k = 0; k < n; k++) {
        const start = new Date(now - back * 86_400_000);
        start.setHours(pick(hours), pick([0, 15, 30, 45]), 0, 0);
        const key = `${d.userId}|${iso(start)}`;
        if (used.has(key)) continue;
        used.add(key);
        const r = rand();
        const status: Status = back < 0 ? 'CONFIRMED' : r < 0.84 ? 'COMPLETED' : r < 0.9 ? 'NO_SHOW' : 'CANCELLED';
        const end = new Date(start.getTime() + 15 * 60_000);
        const a: Appt = { id: `h-${appts.length}`, reference: `MC-H${String(appts.length).padStart(5, '0')}`, patientId: pick(pids), doctorId: d.userId, startsAt: iso(start), endsAt: iso(end), status,
          reason: 'Consultation', feeMinor: d.feeMinor, currency: 'INR', recordIds: [], completedAt: status === 'COMPLETED' ? iso(end) : undefined };
        if (status === 'COMPLETED' && rand() < 0.6) {
          const x = rand();
          a.review = { rating: x < 0.62 ? 5 : x < 0.9 ? 4 : 3, comment: pick(comments), createdAt: iso(new Date(end.getTime() + 3_600_000)) };
        }
        appts.push(a);
      }
    }
    const reviews = appts.filter((a) => a.doctorId === d.userId && a.review);
    if (reviews.length) {
      d.ratingAvg = reviews.reduce((s, a) => s + (a.review?.rating ?? 0), 0) / reviews.length;
      d.ratingCount = reviews.length;
    }
  }
  // Ravi's vitals: blood pressure improving over the last weeks, weekly weight and fasting sugar.
  const vitals: DVital[] = [];
  for (let back = 70; back >= 0; back -= 3) {
    const at = new Date(now - back * 86_400_000);
    at.setHours(8, Math.floor(rand() * 50), 0, 0);
    const improve = back < 35 ? (35 - back) * 0.35 : 0;
    vitals.push({ id: uid(), patientId: 'u-pat', type: 'BP', value: { systolic: Math.round(146 - improve + (rand() - 0.5) * 8), diastolic: Math.round(93 - improve * 0.5 + (rand() - 0.5) * 6) }, recordedAt: iso(at) });
    vitals.push({ id: uid(), patientId: 'u-pat', type: 'HR', value: { bpm: Math.round(78 + (rand() - 0.5) * 8) }, recordedAt: iso(at) });
    if (back % 7 === 0) {
      vitals.push({ id: uid(), patientId: 'u-pat', type: 'WEIGHT', value: { kg: Math.round((82.5 - (70 - back) * 0.03) * 10) / 10 }, recordedAt: iso(at) });
      vitals.push({ id: uid(), patientId: 'u-pat', type: 'GLUCOSE', value: { mgdl: Math.round(104 + (rand() - 0.5) * 14), context: 'fasting' }, recordedAt: iso(at) });
      vitals.push({ id: uid(), patientId: 'u-pat', type: 'SPO2', value: { percent: 97 + Math.floor(rand() * 3) }, recordedAt: iso(at) });
    }
  }
  const notifications: Notif[] = [
    { id: uid(), userId: 'u-pat', type: 'appointment.confirmed', title: 'Consultation confirmed', body: 'With Dr. Kavya Raman · MC-DEMO-NOW001', link: '/appointments/a-now', createdAt: iso(new Date(now - 3_600_000)) },
    { id: uid(), userId: 'u-pat', type: 'prescription.issued', title: 'Prescription ready', body: 'For consultation MC-DEMO-PAST01', link: '/prescription/a-past', readAt: iso(new Date(now - 5 * 86_400_000)), createdAt: iso(new Date(now - 6 * 86_400_000)) },
    { id: uid(), userId: 'd-kavya', type: 'appointment.booked', title: 'New consultation booked', body: 'Ravi Kumar · MC-DEMO-NOW001', link: '/appointments/a-now', createdAt: iso(new Date(now - 3_600_000)) },
  ];
  return { vitals, notifications };
}

// Reference-range flags (informational), duration parsing — mirror the API.
function vitalFlag(type: string, v: Record<string, number | string>): 'high' | 'low' | null {
  const n = (k: string) => Number(v[k]);
  switch (type) {
    case 'BP': return n('systolic') >= 140 || n('diastolic') >= 90 ? 'high' : n('systolic') < 90 || n('diastolic') < 60 ? 'low' : null;
    case 'HR': return n('bpm') > 100 ? 'high' : n('bpm') < 50 ? 'low' : null;
    case 'GLUCOSE': return n('mgdl') >= (v['context'] === 'fasting' ? 126 : 200) ? 'high' : n('mgdl') < 70 ? 'low' : null;
    case 'TEMP': return n('celsius') >= 38 ? 'high' : n('celsius') < 35 ? 'low' : null;
    case 'SPO2': return n('percent') < 94 ? 'low' : null;
    default: return null;
  }
}
function durationDays(text?: string): number | null {
  if (!text || /(ongoing|continue|long[- ]term|sos|as needed)/i.test(text)) return null;
  const m = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)?\b/);
  if (!m) return null;
  const unit = m[2] ?? 'd';
  return Math.round(Number(m[1]) * (unit.startsWith('w') ? 7 : unit.startsWith('m') ? 30 : 1));
}
const vitalView = (v: DVital) => ({ id: v.id, type: v.type, value: v.value, recordedAt: v.recordedAt, flag: vitalFlag(v.type, v.value) });
function notify(db: Db, userId: string, type: string, title: string, body: string, link?: string) {
  (db.notifications ??= []).push({ id: uid(), userId, type, title, body, link, readAt: null, createdAt: iso(new Date()) });
}
function audit(db: Db, u: User, action: string, entity: string, entityId: string) {
  const a = (db.audit ??= []);
  a.push({ id: String(a.length + 1), actorId: u.id, actorRole: u.role, action, entity, entityId, createdAt: iso(new Date()) });
  if (a.length > 400) a.splice(0, a.length - 400);
}
function medications(db: Db, patientId: string) {
  const now = Date.now();
  return db.appts.filter((a) => a.patientId === patientId && a.prescription).flatMap((a) => {
    const rx = a.prescription as { diagnosis?: string; items?: { medicine: string; dosage: string; frequency: string; duration: string; instructions?: string }[]; issuedAt: string };
    return (rx.items ?? []).map((it) => {
      const days = durationDays(it.duration);
      const endsAt = days === null ? null : iso(new Date(new Date(rx.issuedAt).getTime() + days * 86_400_000));
      return { ...it, diagnosis: rx.diagnosis, issuedAt: rx.issuedAt, endsAt, active: endsAt === null || new Date(endsAt).getTime() > now, appointmentId: a.id, doctor: `Dr. ${name(db, a.doctorId)}` };
    });
  }).sort((x, y) => Number(y.active) - Number(x.active));
}

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      if (db.vitals) return db; // created before analytics existed → reseed below
    }
  } catch { /* fresh */ }
  const db = seed();
  save(db);
  return db;
}
function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new ApiError(507, 'Demo storage is full. Use "Reset demo data" in the footer.');
  }
}
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mediconsult-demo') : null;
const chatListeners = new Set<(m: Msg) => void>();
channel?.addEventListener('message', (e) => chatListeners.forEach((l) => l(e.data as Msg)));
export function onChat(fn: (m: Msg) => void) {
  chatListeners.add(fn);
  return () => chatListeners.delete(fn);
}

// ───────── helpers ─────────
const userFrom = (db: Db, auth: string | null) => {
  const u = db.users.find((x) => `Bearer demo.${x.id}` === auth);
  if (!u) throw new ApiError(401, 'Session expired');
  return u;
};
const role = (u: User, ...roles: Role[]) => {
  if (!roles.includes(u.role)) throw new ApiError(403, 'Forbidden');
};
const pubUser = (db: Db, u: User) => ({ id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName, phone: u.phone, timezone: u.timezone, doctorStatus: db.doctors.find((d) => d.userId === u.id)?.status });
const session = (db: Db, u: User) => ({ accessToken: `demo.${u.id}`, refreshToken: `demo.${u.id}.r`, user: pubUser(db, u) });
const name = (db: Db, id: string) => { const u = db.users.find((x) => x.id === id); return u ? `${u.firstName} ${u.lastName}` : id; };
const docView = (db: Db, d: Doctor) => {
  const u = db.users.find((x) => x.id === d.userId)!;
  return {
    id: d.userId, name: `Dr. ${u.firstName} ${u.lastName}`, specialty: d.specialty, qualifications: d.qualifications, experienceYears: d.experienceYears,
    languages: d.languages, bio: d.bio, fee: { amountMinor: d.feeMinor, currency: d.currency }, slotMinutes: d.slotMinutes,
    rating: { average: Math.round(d.ratingAvg * 10) / 10, count: d.ratingCount }, verified: d.status === 'VERIFIED', timezone: u.timezone,
  };
};
const live = (a: Appt) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status) || (a.status === 'PENDING_PAYMENT' && !!a.holdExpiresAt && a.holdExpiresAt > iso(new Date()));
function apptView(db: Db, a: Appt, viewer: User) {
  const d = db.doctors.find((x) => x.userId === a.doctorId)!;
  // Demo: the room is open as soon as a consultation is confirmed.
  const canJoinFrom = ['CONFIRMED', 'IN_PROGRESS'].includes(a.status) ? iso(new Date(Date.now() - 60_000)) : iso(new Date(new Date(a.startsAt).getTime() - 10 * 60_000));
  return {
    id: a.id, reference: a.reference, status: a.status, startsAt: a.startsAt,
    endsAt: ['CONFIRMED', 'IN_PROGRESS'].includes(a.status) ? iso(new Date(Math.max(new Date(a.endsAt).getTime(), Date.now() + 30 * 60_000))) : a.endsAt,
    reason: viewer.role === 'ADMIN' ? undefined : a.reason, fee: { amountMinor: a.feeMinor, currency: a.currency }, holdExpiresAt: a.holdExpiresAt,
    doctor: { id: a.doctorId, name: `Dr. ${name(db, a.doctorId)}`, specialty: d.specialty }, patient: { id: a.patientId, name: name(db, a.patientId) },
    hasPrescription: !!a.prescription, review: a.review ?? null, canJoinFrom,
    records: db.records.filter((r) => a.recordIds.includes(r.id)).map(recView),
  };
}
const recView = (r: Rec) => ({ id: r.id, title: r.title, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, createdAt: r.createdAt });
function party(db: Db, u: User, id: string, allowAdmin = false) {
  const a = db.appts.find((x) => x.id === id);
  if (!a || (a.patientId !== u.id && a.doctorId !== u.id && !(allowAdmin && u.role === 'ADMIN'))) throw new ApiError(404, 'Not found');
  return a;
}
function slots(d: Doctor, db: Db, fromIso: string, days: number) {
  const out: string[] = [];
  const start = new Date(fromIso);
  start.setHours(0, 0, 0, 0);
  const earliest = Date.now() + 15 * 60_000;
  const busy = db.appts.filter((a) => a.doctorId === d.userId && live(a)).map((a) => [new Date(a.startsAt).getTime(), new Date(a.endsAt).getTime()]);
  const off = d.timeOff.map((t) => [new Date(t.startsAt).getTime(), new Date(t.endsAt).getTime()]);
  for (let i = 0; i < Math.min(days, 14); i++) {
    const day = new Date(start.getTime());
    day.setDate(start.getDate() + i);
    const weekday = ((day.getDay() + 6) % 7) + 1;
    for (const rule of d.availability.filter((r) => r.weekday === weekday)) {
      const [sh, sm] = rule.startTime.split(':').map(Number);
      const [eh, em] = rule.endTime.split(':').map(Number);
      const cur = new Date(day); cur.setHours(sh, sm, 0, 0);
      const end = new Date(day); end.setHours(eh, em, 0, 0);
      while (cur.getTime() + d.slotMinutes * 60_000 <= end.getTime()) {
        const s = cur.getTime(), e = s + d.slotMinutes * 60_000;
        const hour = cur.getHours();
        // Demo doctors keep realistic hours: 08:00–13:00 and 15:00–22:00 in the visitor's timezone.
        const inHours = (hour >= 8 && hour < 13) || (hour >= 15 && hour < 22);
        if (inHours && s >= earliest && ![...busy, ...off].some(([bs, be]) => s < be && e > bs)) out.push(new Date(s).toISOString());
        cur.setMinutes(cur.getMinutes() + d.slotMinutes);
      }
    }
  }
  return out;
}
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

// ───────── router ─────────
async function route(db: Db, method: string, path: string, body: unknown, q: URLSearchParams, auth: string | null): Promise<unknown> {
  const seg = path.split('/').filter(Boolean);
  const b = (body ?? {}) as Record<string, unknown>;

  if (path === '/config') return { demoMode: true, paymentProvider: 'demo', jitsiDomain: 'meet.jit.si', consentVersion: '2026-11-v1' };

  if (seg[0] === 'auth') {
    if (seg[1] === 'login') {
      const u = db.users.find((x) => x.email === String(b['email']).toLowerCase() && x.password === b['password']);
      if (!u) throw new ApiError(401, 'Invalid email or password');
      return session(db, u);
    }
    if (seg[1] === 'register' || seg[1] === 'register-doctor') {
      const email = String(b['email'] ?? '').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'email: invalid');
      if (db.users.some((x) => x.email === email)) throw new ApiError(409, 'An account with this email already exists');
      const pw = String(b['password'] ?? '');
      if (pw.length < 10 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) throw new ApiError(400, 'password: 10+ characters with upper, lower case and a number');
      const u: User = { id: uid(), email, password: pw, role: seg[1] === 'register' ? 'PATIENT' : 'DOCTOR', firstName: String(b['firstName'] ?? ''), lastName: String(b['lastName'] ?? ''), phone: b['phone'] as string | undefined, timezone: TZ };
      db.users.push(u);
      if (u.role === 'PATIENT') db.profiles[u.id] = { medicalSummary: { allergies: '', conditions: '', medications: '' } };
      else db.doctors.push({
        userId: u.id, status: 'PENDING', specialty: String(b['specialty']), qualifications: String(b['qualifications']), registrationNumber: String(b['registrationNumber']),
        registrationCouncil: String(b['registrationCouncil']), experienceYears: Number(b['experienceYears']) || 0, languages: (b['languages'] as string[]) ?? ['English'],
        bio: b['bio'] as string | undefined, feeMinor: Number(b['feeMinor']) || 0, currency: 'INR', slotMinutes: 15, ratingAvg: 0, ratingCount: 0, availability: [], timeOff: [], createdAt: iso(new Date()),
      });
      return session(db, u);
    }
    if (seg[1] === 'refresh') {
      const u = db.users.find((x) => `demo.${x.id}.r` === b['refreshToken']);
      if (!u) throw new ApiError(401, 'Session expired');
      return session(db, u);
    }
    if (seg[1] === 'logout') return {};
  }

  // public doctor directory
  if (seg[0] === 'doctors' && seg[1] !== 'me') {
    if (seg[1] === 'specialties') {
      const counts = new Map<string, number>();
      db.doctors.filter((d) => d.status === 'VERIFIED').forEach((d) => counts.set(d.specialty, (counts.get(d.specialty) ?? 0) + 1));
      return [...counts].sort().map(([specialty, doctors]) => ({ specialty, doctors }));
    }
    if (!seg[1]) {
      const s = (q.get('search') ?? '').toLowerCase(), sp = q.get('specialty') ?? '', lang = q.get('language') ?? '';
      const items = db.doctors
        .filter((d) => d.status === 'VERIFIED' && (!sp || d.specialty.toLowerCase() === sp.toLowerCase()) && (!lang || d.languages.includes(lang)))
        .map((d) => docView(db, d))
        .filter((d) => !s || d.name.toLowerCase().includes(s) || d.specialty.toLowerCase().includes(s))
        .sort((x, y) => y.rating.average - x.rating.average);
      return { total: items.length, page: 1, items };
    }
    const d = db.doctors.find((x) => x.userId === seg[1] && x.status === 'VERIFIED');
    if (!d) throw new ApiError(404, 'Doctor not found');
    if (seg[2] === 'slots') return { doctorTimezone: TZ, slotMinutes: d.slotMinutes, slots: slots(d, db, q.get('from') ?? iso(new Date()), Number(q.get('days')) || 7) };
    return { ...docView(db, d), reviews: db.appts.filter((a) => a.doctorId === d.userId && a.review).map((a) => a.review) };
  }

  const u = userFrom(db, auth);
  if (path === '/auth/me') return pubUser(db, u);

  // doctor self-service
  if (seg[0] === 'doctors' && seg[1] === 'me') {
    role(u, 'DOCTOR');
    const d = db.doctors.find((x) => x.userId === u.id)!;
    if (seg[2] === 'insights') return insights(db, u, d);
    if (seg[2] === 'profile' && method === 'PUT') Object.assign(d, Object.fromEntries(Object.entries(b).filter(([k]) => ['bio', 'feeMinor', 'languages', 'slotMinutes'].includes(k))));
    if (seg[2] === 'availability') d.availability = (b['rules'] as Doctor['availability']) ?? [];
    if (seg[2] === 'time-off' && method === 'POST') d.timeOff.push({ id: uid(), startsAt: String(b['startsAt']), endsAt: String(b['endsAt']), reason: b['reason'] as string | undefined });
    if (seg[2] === 'time-off' && method === 'DELETE') d.timeOff = d.timeOff.filter((t) => t.id !== seg[3]);
    return { ...docView(db, d), status: d.status, registrationNumber: d.registrationNumber, registrationCouncil: d.registrationCouncil, availability: d.availability, timeOff: d.timeOff };
  }

  // appointments
  if (seg[0] === 'appointments') {
    if (!seg[1] && method === 'POST') {
      role(u, 'PATIENT');
      const d = db.doctors.find((x) => x.userId === b['doctorId'] && x.status === 'VERIFIED');
      if (!d) throw new ApiError(404, 'Doctor not found');
      if (!b['consent']) throw new ApiError(400, 'Consent is required');
      const startsAt = new Date(String(b['startsAt']));
      if (!slots(d, db, iso(new Date(startsAt.getTime() - 86_400_000)), 2).includes(startsAt.toISOString())) throw new ApiError(409, 'This slot was just taken. Please pick another.');
      const a: Appt = {
        id: uid(), reference: ref(), patientId: u.id, doctorId: d.userId, startsAt: iso(startsAt), endsAt: iso(new Date(startsAt.getTime() + d.slotMinutes * 60_000)),
        status: 'PENDING_PAYMENT', holdExpiresAt: iso(new Date(Date.now() + 10 * 60_000)), reason: String(b['reason'] ?? ''), feeMinor: d.feeMinor, currency: d.currency,
        recordIds: ((b['recordIds'] as string[]) ?? []).filter((id) => db.records.some((r) => r.id === id && r.patientId === u.id)),
      };
      db.appts.push(a);
      return apptView(db, a, u);
    }
    if (!seg[1]) {
      const mine = db.appts.filter((a) => (u.role === 'DOCTOR' ? a.doctorId === u.id : a.patientId === u.id));
      const upcoming = q.get('scope') !== 'past';
      const nowIso = iso(new Date(Date.now() - 30 * 60_000));
      return mine
        .filter((a) => (upcoming ? ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status) && a.endsAt >= nowIso && (a.status !== 'PENDING_PAYMENT' || live(a)) : !['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status) || a.endsAt < nowIso))
        .sort((x, y) => (upcoming ? x.startsAt.localeCompare(y.startsAt) : y.startsAt.localeCompare(x.startsAt)))
        .map((a) => apptView(db, a, u));
    }
    const a = party(db, u, seg[1], seg.length === 2 && method === 'GET');
    const action = seg[2];
    if (!action) return apptView(db, a, u);
    if (action === 'payment' && !seg[3]) {
      if (a.status !== 'PENDING_PAYMENT' || !live(a)) throw new ApiError(400, 'Booking hold expired. Please book again.');
      return { provider: 'demo', orderId: `demo_order_${uid()}`, amountMinor: a.feeMinor, currency: a.currency, clientData: { demo: true } };
    }
    if (action === 'payment' && seg[3] === 'confirm') {
      if (a.status === 'PENDING_PAYMENT') {
        a.status = 'CONFIRMED';
        a.holdExpiresAt = null;
        notify(db, a.patientId, 'appointment.confirmed', 'Consultation confirmed', `With Dr. ${name(db, a.doctorId)} · ${a.reference}`, `/appointments/${a.id}`);
        notify(db, a.doctorId, 'appointment.booked', 'New consultation booked', `${name(db, a.patientId)} · ${a.reference}`, `/appointments/${a.id}`);
        audit(db, u, 'payment.succeeded', 'appointment', a.id);
      }
      return apptView(db, a, u);
    }
    if (action === 'cancel') {
      if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status)) throw new ApiError(400, 'This appointment cannot be cancelled');
      a.status = 'CANCELLED';
      notify(db, u.id === a.patientId ? a.doctorId : a.patientId, 'appointment.cancelled', 'Consultation cancelled', `${a.reference} was cancelled`, `/appointments/${a.id}`);
      audit(db, u, 'appointment.cancel', 'appointment', a.id);
      return apptView(db, a, u);
    }
    if (action === 'join') {
      if (!['CONFIRMED', 'IN_PROGRESS'].includes(a.status)) throw new ApiError(400, 'This consultation is not active');
      if (u.id === a.doctorId) a.status = 'IN_PROGRESS';
      else a.patientJoinedAt ??= iso(new Date());
      return { domain: 'demo', roomName: `demo-${a.id}`, displayName: u.role === 'DOCTOR' ? `Dr. ${name(db, u.id)}` : name(db, u.id), subject: `Consultation ${a.reference}`, isModerator: u.role === 'DOCTOR',
        peerName: u.role === 'DOCTOR' ? name(db, a.patientId) : `Dr. ${name(db, a.doctorId)}` };
    }
    const doctorOnly = () => { if (a.doctorId !== u.id) throw new ApiError(403, 'Only the treating doctor can do this'); };
    if (action === 'vitals') {
      doctorOnly();
      audit(db, u, 'vitals.read', 'patient', a.patientId);
      return (db.vitals ?? []).filter((v) => v.patientId === a.patientId).sort((x, y) => x.recordedAt.localeCompare(y.recordedAt)).map(vitalView);
    }
    if (action === 'notes') {
      doctorOnly();
      if (method === 'PUT') a.notes = b as Record<string, string>;
      return a.notes ?? {};
    }
    if (action === 'prescription') {
      if (method === 'PUT') {
        doctorOnly();
        notify(db, a.patientId, 'prescription.issued', a.prescription ? 'Prescription updated' : 'Prescription ready', `For consultation ${a.reference}`, `/prescription/${a.id}`);
        a.prescription = { ...b, issuedAt: a.prescription?.issuedAt ?? iso(new Date()) };
        audit(db, u, 'prescription.write', 'appointment', a.id);
      }
      if (!a.prescription) throw new ApiError(404, 'No prescription yet');
      const d = db.doctors.find((x) => x.userId === a.doctorId)!;
      const p = db.profiles[a.patientId];
      return {
        id: a.id, reference: a.reference, ...a.prescription,
        doctor: { name: `Dr. ${name(db, a.doctorId)}`, qualifications: d.qualifications, registrationNumber: d.registrationNumber, registrationCouncil: d.registrationCouncil, specialty: d.specialty },
        patient: { name: name(db, a.patientId), dateOfBirth: p?.dateOfBirth, gender: p?.gender },
      };
    }
    if (action === 'complete') {
      doctorOnly();
      a.status = 'COMPLETED';
      a.completedAt = iso(new Date());
      notify(db, a.patientId, 'appointment.completed', 'How was your consultation?', `Rate your consultation ${a.reference}`, `/appointments/${a.id}`);
      audit(db, u, 'appointment.complete', 'appointment', a.id);
      return apptView(db, a, u);
    }
    if (action === 'no-show') {
      doctorOnly();
      if (a.patientJoinedAt) throw new ApiError(400, 'The patient joined this consultation');
      a.status = 'NO_SHOW';
      return apptView(db, a, u);
    }
    if (action === 'review') {
      if (a.patientId !== u.id || a.status !== 'COMPLETED') throw new ApiError(400, 'You can review after the consultation');
      if (a.review) throw new ApiError(409, 'Already reviewed');
      a.review = { rating: Number(b['rating']), comment: b['comment'] as string | undefined, createdAt: iso(new Date()) };
      const d = db.doctors.find((x) => x.userId === a.doctorId)!;
      d.ratingAvg = (d.ratingAvg * d.ratingCount + a.review.rating) / (d.ratingCount + 1);
      d.ratingCount++;
      notify(db, a.doctorId, 'review.received', `New ${a.review.rating}-star review`, `For consultation ${a.reference}`, '/doctor/insights');
      return { ok: true };
    }
    if (action === 'messages') {
      if (method === 'GET') return db.messages.filter((m) => m.appointmentId === a.id);
      const text = String(b['body'] ?? '').trim().slice(0, 4000);
      if (!text) throw new ApiError(400, 'Empty message');
      if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) throw new ApiError(400, 'Chat is not open for this appointment');
      const m: Msg = { id: uid(), appointmentId: a.id, senderId: u.id, body: text, createdAt: iso(new Date()) };
      db.messages.push(m);
      setTimeout(() => channel?.postMessage(m), 50);
      return m;
    }
  }

  if (seg[0] === 'me' && seg[1] === 'notifications') {
    const mine = (db.notifications ??= []).filter((n) => n.userId === u.id);
    if (seg[2] === 'read') {
      const ids = (b['ids'] as string[] | undefined) ?? [];
      mine.forEach((n) => { if (!n.readAt && (!ids.length || ids.includes(n.id))) n.readAt = iso(new Date()); });
    }
    return { unread: mine.filter((n) => !n.readAt).length, items: [...mine].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 30) };
  }

  // patient
  if (seg[0] === 'me') {
    role(u, 'PATIENT');
    if (seg[1] === 'vitals') {
      const list = (db.vitals ??= []);
      if (method === 'POST') {
        const v: DVital = { id: uid(), patientId: u.id, type: String(b['type']), value: (b['value'] ?? {}) as Record<string, number | string>, recordedAt: String(b['recordedAt'] ?? iso(new Date())) };
        list.push(v);
        return vitalView(v);
      }
      if (method === 'DELETE') {
        db.vitals = list.filter((v) => !(v.id === seg[2] && v.patientId === u.id));
        return { ok: true };
      }
      const since = Date.now() - (Number(q.get('days')) || 180) * 86_400_000;
      const type = q.get('type');
      return list.filter((v) => v.patientId === u.id && new Date(v.recordedAt).getTime() >= since && (!type || v.type === type)).sort((x, y) => x.recordedAt.localeCompare(y.recordedAt)).map(vitalView);
    }
    if (seg[1] === 'medications') return medications(db, u.id);
    if (seg[1] === 'health-summary') {
      const latest: Record<string, unknown> = {};
      (db.vitals ?? []).filter((v) => v.patientId === u.id).sort((x, y) => x.recordedAt.localeCompare(y.recordedAt)).forEach((v) => (latest[v.type] = vitalView(v)));
      const next = db.appts.filter((a) => a.patientId === u.id && a.status === 'CONFIRMED' && a.endsAt >= iso(new Date())).sort((x, y) => x.startsAt.localeCompare(y.startsAt))[0];
      return {
        latest, activeMedications: medications(db, u.id).filter((m) => m.active).length,
        consultations: db.appts.filter((a) => a.patientId === u.id && a.status === 'COMPLETED').length, records: db.records.filter((r) => r.patientId === u.id).length,
        next: next ? { id: next.id, startsAt: next.startsAt, doctor: `Dr. ${name(db, next.doctorId)}`, specialty: db.doctors.find((d) => d.userId === next.doctorId)?.specialty } : null,
      };
    }
    const p = (db.profiles[u.id] ??= { medicalSummary: { allergies: '', conditions: '', medications: '' } });
    if (seg[1] === 'profile') {
      if (method === 'PUT') {
        const { phone, timezone: _tz, ...rest } = b as Record<string, unknown>;
        Object.assign(p, rest);
        if (phone) u.phone = String(phone);
      }
      return { firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, timezone: u.timezone, ...p };
    }
    if (seg[1] === 'records') {
      if (method === 'GET') return db.records.filter((r) => r.patientId === u.id).map(recView).reverse();
      if (method === 'DELETE') {
        db.records = db.records.filter((r) => !(r.id === seg[2] && r.patientId === u.id));
        return { ok: true };
      }
      const form = body as FormData;
      const file = form.get('file') as File | null;
      if (!file) throw new ApiError(400, 'File required');
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) throw new ApiError(400, 'Only PDF, PNG or JPEG files');
      if (file.size > 1024 * 1024) throw new ApiError(400, 'Demo limit: 1 MB per file (10 MB in production)');
      const r: Rec = { id: uid(), patientId: u.id, title: String(form.get('title') || file.name).slice(0, 200), fileName: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl: await readFile(file), createdAt: iso(new Date()) };
      db.records.push(r);
      return recView(r);
    }
    if (seg[1] === 'export') return { exportedAt: iso(new Date()), profile: p, records: db.records.filter((r) => r.patientId === u.id).map(recView), appointments: db.appts.filter((a) => a.patientId === u.id).map((a) => ({ reference: a.reference, startsAt: a.startsAt, status: a.status, reason: a.reason, prescription: a.prescription ?? null })) };
    if (seg[1] === 'delete-request') return { ok: true, message: 'Your request is recorded. In this demo nothing is deleted; use "Reset demo data" to clear everything.' };
  }

  if (seg[0] === 'records' && seg[2] === 'download') {
    const r = db.records.find((x) => x.id === seg[1]);
    const allowed = r && (r.patientId === u.id || (u.role === 'DOCTOR' && db.appts.some((a) => a.doctorId === u.id && a.recordIds.includes(r.id))));
    if (!r || !allowed) throw new ApiError(404, 'Not found');
    return await (await fetch(r.dataUrl)).blob();
  }

  if (seg[0] === 'admin') {
    role(u, 'ADMIN');
    if (seg[1] === 'stats') {
      const since = Date.now() - 30 * 86_400_000;
      return {
        patients: db.users.filter((x) => x.role === 'PATIENT').length, doctors: db.doctors.filter((d) => d.status === 'VERIFIED').length,
        pendingDoctors: db.doctors.filter((d) => d.status === 'PENDING').length, upcoming: db.appts.filter((a) => a.status === 'CONFIRMED').length,
        completed30: db.appts.filter((a) => a.status === 'COMPLETED' && new Date(a.completedAt ?? 0).getTime() > since).length,
        revenue30Minor: db.appts.filter((a) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)).reduce((s, a) => s + a.feeMinor, 0),
      };
    }
    if (seg[1] === 'doctors' && !seg[2]) {
      const status = q.get('status');
      return db.doctors.filter((d) => !status || d.status === status).map((d) => {
        const du = db.users.find((x) => x.id === d.userId)!;
        return { id: d.userId, name: `Dr. ${du.firstName} ${du.lastName}`, email: du.email, status: d.status, specialty: d.specialty, qualifications: d.qualifications, registrationNumber: d.registrationNumber, registrationCouncil: d.registrationCouncil, experienceYears: d.experienceYears, createdAt: d.createdAt };
      });
    }
    if (seg[1] === 'analytics') return analytics(db);
    if (seg[1] === 'audit') {
      const e = q.get('entityId');
      return [...(db.audit ?? [])].reverse().filter((x) => !e || x.entityId === e);
    }
    if (seg[1] === 'appointments') {
      const st = q.get('status'), s = (q.get('search') ?? '').toLowerCase(), page = Math.max(1, Number(q.get('page')) || 1);
      const rows = db.appts
        .filter((a) => (!st || a.status === st) && (!s || a.reference.toLowerCase().includes(s) || name(db, a.patientId).toLowerCase().includes(s) || name(db, a.doctorId).toLowerCase().includes(s)))
        .sort((x, y) => y.startsAt.localeCompare(x.startsAt));
      return {
        total: rows.length, page, pageSize: 25,
        items: rows.slice((page - 1) * 25, page * 25).map((a) => ({
          id: a.id, reference: a.reference, status: a.status, startsAt: a.startsAt, createdAt: a.startsAt, fee: { amountMinor: a.feeMinor, currency: a.currency },
          payment: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'].includes(a.status) ? 'SUCCEEDED' : null, patient: name(db, a.patientId),
          doctor: `Dr. ${name(db, a.doctorId)}`, specialty: db.doctors.find((d) => d.userId === a.doctorId)?.specialty,
        })),
      };
    }
    if (seg[1] === 'doctors' && seg[3] === 'status') {
      const d = db.doctors.find((x) => x.userId === seg[2]);
      if (!d) throw new ApiError(404, 'Not found');
      d.status = b['status'] as Doctor['status'];
      notify(db, d.userId, `doctor.${d.status.toLowerCase()}`, d.status === 'VERIFIED' ? 'Your profile is verified' : 'Your profile was suspended', d.status === 'VERIFIED' ? 'Patients can now book you.' : `Reason: ${b['note'] ?? 'contact support'}`);
      audit(db, u, `admin.doctor_${d.status.toLowerCase()}`, 'doctor', d.userId);
      if (d.status === 'VERIFIED' && !d.availability.length) d.availability = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:45' }));
      return { ok: true };
    }
  }

  throw new ApiError(404, `No demo route for ${method} ${path}`);
}

const PAID: Status[] = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function insights(db: Db, u: User, d: Doctor) {
  const mine = db.appts.filter((a) => a.doctorId === u.id);
  const now = new Date();
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const from = new Date(monday.getTime() - 11 * 7 * 86_400_000);
  const weekly = Array.from({ length: 12 }, (_, i) => ({ week: dayKey(new Date(from.getTime() + i * 7 * 86_400_000)), consultations: 0, earningsMinor: 0, noShows: 0 }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const a of mine) {
    const t = new Date(a.startsAt);
    const i = Math.floor((t.getTime() - from.getTime()) / (7 * 86_400_000));
    if (i >= 0 && i < 12) {
      if (a.status === 'COMPLETED') weekly[i].consultations++;
      if (a.status === 'NO_SHOW') weekly[i].noShows++;
      if (PAID.includes(a.status)) weekly[i].earningsMinor += a.feeMinor;
    }
    if (PAID.includes(a.status)) heat[(t.getDay() + 6) % 7][t.getHours()]++;
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevCut = new Date(Math.min(prevStart.getTime() + (now.getTime() - monthStart.getTime()), monthStart.getTime()));
  const inR = (a: Appt, x: Date, y: Date) => new Date(a.startsAt) >= x && new Date(a.startsAt) < y;
  const done = mine.filter((a) => a.status === 'COMPLETED');
  const cThis = done.filter((a) => inR(a, monthStart, now)).length, cPrev = done.filter((a) => inR(a, prevStart, prevCut)).length;
  const paid = mine.filter((a) => PAID.includes(a.status));
  const eThis = paid.filter((a) => inR(a, monthStart, now)).reduce((s, a) => s + a.feeMinor, 0), ePrev = paid.filter((a) => inR(a, prevStart, prevCut)).reduce((s, a) => s + a.feeMinor, 0);
  const pct = (x: number, y: number) => (!y ? (x ? null : 0) : Math.round(((x - y) / y) * 100));
  const fin = mine.filter((a) => ['COMPLETED', 'NO_SHOW'].includes(a.status));
  const visits = new Map<string, number>();
  done.forEach((a) => visits.set(a.patientId, (visits.get(a.patientId) ?? 0) + 1));
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const today1 = new Date(today0.getTime() + 86_400_000);
  const reviews = mine.filter((a) => a.review).sort((x, y) => (y.review!.createdAt).localeCompare(x.review!.createdAt));
  return {
    timezone: TZ, currency: d.currency,
    kpis: {
      consultationsThisMonth: cThis, consultationsChange: pct(cThis, cPrev), earningsThisMonthMinor: eThis, earningsChange: pct(eThis, ePrev),
      rating: Math.round(d.ratingAvg * 10) / 10, ratingCount: d.ratingCount, noShowRate: fin.length ? Math.round((fin.filter((a) => a.status === 'NO_SHOW').length / fin.length) * 100) : 0,
      uniquePatients: visits.size, repeatPatientRate: visits.size ? Math.round(([...visits.values()].filter((n) => n > 1).length / visits.size) * 100) : 0,
    },
    weekly, heatmap: heat,
    ratingDistribution: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: reviews.filter((a) => a.review!.rating === r).length })),
    recentReviews: reviews.slice(0, 6).map((a) => { const p = db.users.find((x) => x.id === a.patientId); return { rating: a.review!.rating, comment: a.review!.comment, createdAt: a.review!.createdAt, patient: `${p?.firstName} ${p?.lastName.charAt(0)}.` }; }),
    today: mine.filter((a) => inR(a, today0, today1) && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'].includes(a.status)).sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      .map((a) => ({ id: a.id, startsAt: a.startsAt, status: a.status, reference: a.reference, patient: name(db, a.patientId) })),
  };
}

function analytics(db: Db) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 29);
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: dayKey(new Date(start.getTime() + i * 86_400_000)), bookings: 0, revenueMinor: 0 }));
  const idx = new Map(daily.map((d, i) => [d.date, i]));
  const recent = db.appts.filter((a) => new Date(a.startsAt) >= start && new Date(a.startsAt) <= new Date());
  const byStatus: Record<string, number> = {}, bySpec: Record<string, number> = {}, byDoc: Record<string, number> = {};
  for (const a of recent) {
    const i = idx.get(dayKey(new Date(a.startsAt)));
    if (i !== undefined) { daily[i].bookings++; if (PAID.includes(a.status)) daily[i].revenueMinor += a.feeMinor; }
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) {
      const sp = db.doctors.find((d) => d.userId === a.doctorId)?.specialty ?? 'Other';
      bySpec[sp] = (bySpec[sp] ?? 0) + 1;
      byDoc[a.doctorId] = (byDoc[a.doctorId] ?? 0) + 1;
    }
  }
  const n = recent.length || 1;
  return {
    days: 30, daily, byStatus,
    bySpecialty: Object.entries(bySpec).map(([specialty, count]) => ({ specialty, count })).sort((x, y) => y.count - x.count),
    conversionRate: Math.round((recent.filter((a) => PAID.includes(a.status)).length / n) * 100),
    cancellationRate: Math.round(((byStatus['CANCELLED'] ?? 0) / n) * 100),
    refundsMinor: recent.filter((a) => a.status === 'CANCELLED').reduce((s, a) => s + a.feeMinor, 0),
    topDoctors: db.doctors.filter((d) => d.status === 'VERIFIED').map((d) => ({ id: d.userId, name: `Dr. ${name(db, d.userId)}`, specialty: d.specialty, consultations: byDoc[d.userId] ?? 0, rating: Math.round(d.ratingAvg * 10) / 10, ratingCount: d.ratingCount }))
      .sort((x, y) => y.consultations - x.consultations).slice(0, 6),
  };
}

export function handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
  const url = new URL(req.urlWithParams, location.origin);
  const path = url.pathname.replace(/^.*\/api\/v1/, '');
  const db = load();
  const work = route(db, req.method, path, req.body, url.searchParams, req.headers.get('Authorization')).then((result) => {
    save(db);
    return result instanceof Blob ? result : JSON.parse(JSON.stringify(result ?? {}));
  });
  return from(work).pipe(
    delay(150),
    switchMap((body) => of(new HttpResponse({ status: 200, body, url: req.url }))),
    catchError((e) => {
      const err = e instanceof ApiError ? e : new ApiError(500, (e as Error).message);
      return throwError(() => new HttpErrorResponse({ status: err.status, error: { message: err.message }, url: req.url }));
    }),
  );
}
