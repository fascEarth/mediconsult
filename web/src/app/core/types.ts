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
