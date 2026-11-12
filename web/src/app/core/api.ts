import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { config } from './config';
import type { Appointment, ChatMessage, Doctor, MedicalRecord, Prescription, PublicConfig } from './types';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private b = config.apiUrl;
  readonly publicConfig = signal<PublicConfig | null>(null);

  private get<T>(path: string, params?: Record<string, unknown>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '' && v !== null) p = p.set(k, String(v));
    return firstValueFrom(this.http.get<T>(`${this.b}${path}`, { params: p }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.b}${path}`, body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.b}${path}`, body));
  }

  async loadConfig() {
    this.publicConfig.set(await this.get<PublicConfig>('/config'));
  }

  // doctors
  doctors = (q: { specialty?: string; language?: string; search?: string; page?: number }) => this.get<{ total: number; page: number; items: Doctor[] }>('/doctors', q);
  specialties = () => this.get<{ specialty: string; doctors: number }[]>('/doctors/specialties');
  doctor = (id: string) => this.get<Doctor>(`/doctors/${id}`);
  slots = (id: string, from: string, days = 7) => this.get<{ doctorTimezone: string; slotMinutes: number; slots: string[] }>(`/doctors/${id}/slots`, { from, days });
  myDoctorProfile = () => this.get<Doctor & { status: string; availability: { weekday: number; startTime: string; endTime: string }[]; timeOff: { id: string; startsAt: string; endsAt: string; reason?: string }[] }>('/doctors/me/profile');
  updateDoctorProfile = (body: unknown) => this.put('/doctors/me/profile', body);
  setAvailability = (rules: unknown) => this.put('/doctors/me/availability', { rules });
  addTimeOff = (body: unknown) => this.post('/doctors/me/time-off', body);
  removeTimeOff = (id: string) => firstValueFrom(this.http.delete(`${this.b}/doctors/me/time-off/${id}`));

  // appointments
  book = (body: { doctorId: string; startsAt: string; reason: string; consent: true; recordIds?: string[] }) => this.post<Appointment>('/appointments', body);
  appointments = (scope: 'upcoming' | 'past') => this.get<Appointment[]>('/appointments', { scope });
  appointment = (id: string) => this.get<Appointment>(`/appointments/${id}`);
  createPayment = (id: string) => this.post<{ provider: string; orderId: string; amountMinor: number; currency: string; clientData: Record<string, unknown> }>(`/appointments/${id}/payment`);
  confirmPayment = (id: string, body: { orderId: string; paymentId: string; signature?: string }) => this.post<Appointment>(`/appointments/${id}/payment/confirm`, body);
  cancel = (id: string, reason?: string) => this.post<Appointment>(`/appointments/${id}/cancel`, { reason });
  join = (id: string) => this.post<{ domain: string; roomName: string; displayName: string; subject: string; isModerator: boolean }>(`/appointments/${id}/join`);
  notes = (id: string) => this.get<Record<string, string>>(`/appointments/${id}/notes`);
  saveNotes = (id: string, body: unknown) => this.put(`/appointments/${id}/notes`, body);
  prescription = (id: string) => this.get<Prescription>(`/appointments/${id}/prescription`);
  savePrescription = (id: string, body: unknown) => this.put<Prescription>(`/appointments/${id}/prescription`, body);
  complete = (id: string) => this.post<Appointment>(`/appointments/${id}/complete`);
  noShow = (id: string) => this.post<Appointment>(`/appointments/${id}/no-show`);
  review = (id: string, rating: number, comment?: string) => this.post(`/appointments/${id}/review`, { rating, comment });
  messages = (id: string) => this.get<ChatMessage[]>(`/appointments/${id}/messages`);
  sendMessage = (id: string, body: string) => this.post<ChatMessage>(`/appointments/${id}/messages`, { body });

  // patient
  profile = () => this.get<Record<string, unknown> & { medicalSummary: { allergies: string; conditions: string; medications: string } }>('/me/profile');
  updateProfile = (body: unknown) => this.put('/me/profile', body);
  records = () => this.get<MedicalRecord[]>('/me/records');
  uploadRecord(title: string, file: File) {
    const form = new FormData();
    form.append('title', title);
    form.append('file', file);
    return firstValueFrom(this.http.post<MedicalRecord>(`${this.b}/me/records`, form));
  }
  deleteRecord = (id: string) => firstValueFrom(this.http.delete(`${this.b}/me/records/${id}`));
  downloadRecord = (id: string) => firstValueFrom(this.http.get(`${this.b}/records/${id}/download`, { responseType: 'blob' }));
  exportData = () => this.get<unknown>('/me/export');
  requestDeletion = () => this.post<{ message: string }>('/me/delete-request');

  // admin
  adminStats = () => this.get<Record<string, number>>('/admin/stats');
  adminDoctors = (status?: string) => this.get<{ id: string; name: string; email: string; status: string; specialty: string; qualifications: string; registrationNumber: string; registrationCouncil: string; experienceYears: number; createdAt: string }[]>('/admin/doctors', { status });
  setDoctorStatus = (id: string, status: 'VERIFIED' | 'SUSPENDED', note?: string) => this.post(`/admin/doctors/${id}/status`, { status, note });
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
