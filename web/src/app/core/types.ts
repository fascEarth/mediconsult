export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  phone?: string;
  timezone: string;
  doctorStatus?: 'PENDING' | 'VERIFIED' | 'SUSPENDED';
}

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  qualifications: string;
  experienceYears: number;
  languages: string[];
  bio?: string;
  photoUrl?: string;
  fee: Money;
  slotMinutes: number;
  rating: { average: number; count: number };
  verified: boolean;
  timezone: string;
  reviews?: { rating: number; comment?: string; createdAt: string }[];
}

export type AppointmentStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';

export interface Appointment {
  id: string;
  reference: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  reason?: string;
  fee: Money;
  holdExpiresAt?: string;
  doctor: { id: string; name?: string; specialty?: string };
  patient: { id: string; name?: string };
  hasPrescription: boolean;
  review: { rating: number; comment?: string } | null;
  canJoinFrom: string;
  records?: MedicalRecord[];
}

export interface MedicalRecord {
  id: string;
  title: string;
  fileName?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PrescriptionItem {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

export interface Prescription {
  id: string;
  reference: string;
  issuedAt: string;
  diagnosis: string;
  items: PrescriptionItem[];
  advice?: string;
  followUpDays?: number;
  doctor: { name: string; qualifications: string; registrationNumber: string; registrationCouncil: string; specialty: string };
  patient: { name: string; dateOfBirth?: string; gender?: string };
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface PublicConfig {
  demoMode: boolean;
  paymentProvider: 'demo' | 'razorpay';
  razorpayKeyId?: string;
  jitsiDomain: string;
  consentVersion: string;
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  EXPIRED: 'Expired',
};

// ── Health, notifications and analytics ──

export type VitalType = 'BP' | 'HR' | 'WEIGHT' | 'GLUCOSE' | 'TEMP' | 'SPO2';

export interface Vital {
  id: string;
  type: VitalType;
  value: Record<string, number | string>;
  recordedAt: string;
  flag: 'high' | 'low' | null;
}

export const VITALS: Record<VitalType, { label: string; unit: string; fields: { key: string; label: string; step?: number }[]; primary: string }> = {
  BP: { label: 'Blood pressure', unit: 'mmHg', fields: [{ key: 'systolic', label: 'Systolic' }, { key: 'diastolic', label: 'Diastolic' }], primary: 'systolic' },
  HR: { label: 'Heart rate', unit: 'bpm', fields: [{ key: 'bpm', label: 'Beats per minute' }], primary: 'bpm' },
  WEIGHT: { label: 'Weight', unit: 'kg', fields: [{ key: 'kg', label: 'Kilograms', step: 0.1 }], primary: 'kg' },
  GLUCOSE: { label: 'Blood sugar', unit: 'mg/dL', fields: [{ key: 'mgdl', label: 'mg/dL' }], primary: 'mgdl' },
  TEMP: { label: 'Temperature', unit: '°C', fields: [{ key: 'celsius', label: '°C', step: 0.1 }], primary: 'celsius' },
  SPO2: { label: 'Oxygen (SpO₂)', unit: '%', fields: [{ key: 'percent', label: 'Percent' }], primary: 'percent' },
};

export function vitalText(v: Pick<Vital, 'type' | 'value'>): string {
  const x = v.value;
  switch (v.type) {
    case 'BP': return `${x['systolic']}/${x['diastolic']}`;
    case 'HR': return `${x['bpm']}`;
    case 'WEIGHT': return `${x['kg']}`;
    case 'GLUCOSE': return `${x['mgdl']}`;
    case 'TEMP': return `${x['celsius']}`;
    case 'SPO2': return `${x['percent']}`;
  }
}

export interface Medication {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
  diagnosis?: string;
  issuedAt: string;
  endsAt: string | null;
  active: boolean;
  appointmentId: string;
  doctor: string;
}

export interface HealthSummary {
  latest: Partial<Record<VitalType, Vital>>;
  activeMedications: number;
  consultations: number;
  records: number;
  next: { id: string; startsAt: string; doctor: string; specialty: string } | null;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface DoctorInsights {
  timezone: string;
  currency: string;
  kpis: {
    consultationsThisMonth: number; consultationsChange: number | null;
    earningsThisMonthMinor: number; earningsChange: number | null;
    rating: number; ratingCount: number; noShowRate: number; uniquePatients: number; repeatPatientRate: number;
  };
  weekly: { week: string; consultations: number; earningsMinor: number; noShows: number }[];
  heatmap: number[][];
  ratingDistribution: { rating: number; count: number }[];
  recentReviews: { rating: number; comment?: string | null; createdAt: string; patient: string }[];
  today: { id: string; startsAt: string; status: AppointmentStatus; reference: string; patient: string }[];
}

export interface AdminAnalytics {
  days: number;
  daily: { date: string; bookings: number; revenueMinor: number }[];
  byStatus: Partial<Record<AppointmentStatus, number>>;
  bySpecialty: { specialty: string; count: number }[];
  conversionRate: number;
  cancellationRate: number;
  refundsMinor: number;
  topDoctors: { id: string; name: string; specialty: string; consultations: number; rating: number; ratingCount: number }[];
}

export interface AdminAppointment {
  id: string;
  reference: string;
  status: AppointmentStatus;
  startsAt: string;
  createdAt: string;
  fee: Money;
  payment: 'SUCCEEDED' | 'REFUNDED' | null;
  patient: string;
  doctor: string;
  specialty: string;
}

export interface AuditEntry {
  id: string;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
}
