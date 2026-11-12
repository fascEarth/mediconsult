import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, saveBlob } from '../core/api';
import { errorText } from '../core/auth';
import type { MedicalRecord } from '../core/types';

@Component({
  imports: [FormsModule, DatePipe, DecimalPipe],
  template: `
    <div class="page two-col">
      <form class="card pad stack" (ngSubmit)="save()">
        <h1>Health profile</h1>
        <p class="muted small">Shared only with doctors you consult. Medical details are encrypted.</p>
        <div class="grid-2">
          <label>Date of birth<input type="date" name="dob" [(ngModel)]="m.dateOfBirth" /></label>
          <label>Sex
            <select name="gender" [(ngModel)]="m.gender"><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select>
          </label>
          <label>Blood group
            <select name="bg" [(ngModel)]="m.bloodGroup"><option value="">—</option>@for (b of bloodGroups; track b) {<option [value]="b">{{ b }}</option>}</select>
          </label>
          <label>Mobile<input type="tel" name="phone" [(ngModel)]="m.phone" /></label>
        </div>
        <label>Emergency contact<input name="ec" [(ngModel)]="m.emergencyContact" placeholder="Name, relation, phone" /></label>
        <label>Allergies<textarea rows="2" name="al" [(ngModel)]="m.medicalSummary.allergies"></textarea></label>
        <label>Long-term conditions<textarea rows="2" name="co" [(ngModel)]="m.medicalSummary.conditions"></textarea></label>
        <label>Current medicines<textarea rows="2" name="me" [(ngModel)]="m.medicalSummary.medications"></textarea></label>
        @if (msg()) {<p class="ok-text">{{ msg() }}</p>}
        @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
        <button class="btn primary">Save profile</button>
      </form>

      <aside class="stack">
        <div class="card pad">
          <h3>Medical records</h3>
          <p class="muted small">PDF, PNG or JPEG, up to 10 MB. Encrypted at rest.</p>
          <div class="upload">
            <input name="title" [(ngModel)]="title" placeholder="Title, e.g. Blood test May 2026" aria-label="Record title" />
            <input type="file" accept="application/pdf,image/png,image/jpeg" (change)="pick($event)" aria-label="Choose file" />
            <button class="btn" (click)="upload()" [disabled]="!file || uploading()">{{ uploading() ? 'Uploading…' : 'Upload' }}</button>
          </div>
          @for (r of records(); track r.id) {
            <div class="row-between record">
              <button class="link" (click)="download(r)">📄 {{ r.title }}</button>
              <small class="muted">{{ r.createdAt | date: 'd MMM y' }} · {{ (r.sizeBytes / 1024) | number: '1.0-0' }} KB</small>
              <button class="link danger" (click)="remove(r)" aria-label="Delete">✕</button>
            </div>
          } @empty {<p class="muted">No records yet.</p>}
        </div>
        <div class="card pad">
          <h3>Your data</h3>
          <p class="muted small">Download everything we hold about you, or ask us to delete your account.</p>
          <div class="actions">
            <button class="btn" (click)="exportData()">Download my data</button>
            <button class="btn ghost danger" (click)="deleteAccount()">Request deletion</button>
          </div>
        </div>
      </aside>
    </div>
  `,
})
export default class ProfilePage implements OnInit {
  private api = inject(Api);
  bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  m: { dateOfBirth?: string; gender?: string; bloodGroup?: string; phone?: string; emergencyContact?: string; medicalSummary: { allergies: string; conditions: string; medications: string } } =
    { medicalSummary: { allergies: '', conditions: '', medications: '' } };
  records = signal<MedicalRecord[]>([]);
  msg = signal('');
  error = signal('');
  uploading = signal(false);
  title = '';
  file?: File;

  async ngOnInit() {
    try {
      const p = await this.api.profile();
      this.m = {
        dateOfBirth: p['dateOfBirth'] ? String(p['dateOfBirth']).slice(0, 10) : undefined,
        gender: (p['gender'] as string) ?? '', bloodGroup: (p['bloodGroup'] as string) ?? '',
        phone: (p['phone'] as string) ?? '', emergencyContact: (p['emergencyContact'] as string) ?? '',
        medicalSummary: p.medicalSummary,
      };
      this.records.set(await this.api.records());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async save() {
    this.msg.set('');
    this.error.set('');
    const clean = Object.fromEntries(Object.entries(this.m).filter(([, v]) => v !== '' && v !== undefined));
    try {
      await this.api.updateProfile(clean);
      this.msg.set('Saved');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  pick(ev: Event) {
    this.file = (ev.target as HTMLInputElement).files?.[0];
  }

  async upload() {
    if (!this.file) return;
    this.uploading.set(true);
    this.error.set('');
    try {
      await this.api.uploadRecord(this.title || this.file.name, this.file);
      this.records.set(await this.api.records());
      this.title = '';
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.uploading.set(false);
    }
  }

  async download(r: MedicalRecord) {
    saveBlob(await this.api.downloadRecord(r.id), r.fileName ?? r.title);
  }

  async remove(r: MedicalRecord) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    await this.api.deleteRecord(r.id);
    this.records.set(await this.api.records());
  }

  async exportData() {
    const data = await this.api.exportData();
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'mediconsult-my-data.json');
  }

  async deleteAccount() {
    if (!confirm('Request deletion of your account? Clinical records are kept as the law requires.')) return;
    const r = await this.api.requestDeletion();
    this.msg.set(r.message);
  }
}
