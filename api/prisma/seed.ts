/**
 * Demo data. All people are fictional.
 *   admin@mediconsult.demo   / Admin@12345
 *   patient@mediconsult.demo / Patient@12345
 *   doctor@mediconsult.demo  / Doctor@12345   (Dr. Kavya Raman, General Physician)
 */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

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

  console.log('Seeded MediConsult demo data. Patient: patient@mediconsult.demo / Patient@12345');
}

main().finally(() => prisma.$disconnect());
