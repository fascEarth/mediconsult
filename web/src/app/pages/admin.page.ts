import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import { MoneyPipe } from '../shared/ui';

@Component({
  imports: [DatePipe, FormsModule, MoneyPipe],
  template: `
    <div class="page">
      <h1>Admin</h1>
      @if (stats(); as s) {
        <div class="stats">
          <div class="card stat"><span class="muted">Patients</span><b>{{ s['patients'] }}</b></div>
          <div class="card stat"><span class="muted">Verified doctors</span><b>{{ s['doctors'] }}</b></div>
          <div class="card stat"><span class="muted">Pending verification</span><b>{{ s['pendingDoctors'] }}</b></div>
          <div class="card stat"><span class="muted">Upcoming consultations</span><b>{{ s['upcoming'] }}</b></div>
          <div class="card stat"><span class="muted">Completed (30 days)</span><b>{{ s['completed30'] }}</b></div>
          <div class="card stat"><span class="muted">Revenue (30 days)</span><b>{{ { amountMinor: s['revenue30Minor'], currency: 'INR' } | money }}</b></div>
        </div>
      }
      <div class="row-between">
        <h2>Doctors</h2>
        <select [(ngModel)]="filter" (change)="load()" name="f" aria-label="Status filter">
          <option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="SUSPENDED">Suspended</option><option value="">All</option>
        </select>
      </div>
      @if (error()) {<p class="error">{{ error() }}</p>}
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Doctor</th><th>Specialty</th><th>Registration</th><th>Applied</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (d of doctors(); track d.id) {
              <tr>
                <td><b>{{ d.name }}</b><br /><small class="muted">{{ d.email }}</small></td>
                <td>{{ d.specialty }}<br /><small class="muted">{{ d.qualifications }} · {{ d.experienceYears }} yrs</small></td>
                <td>{{ d.registrationNumber }}<br /><small class="muted">{{ d.registrationCouncil }}</small></td>
                <td>{{ d.createdAt | date: 'd MMM y' }}</td>
                <td><span class="tag">{{ d.status }}</span></td>
                <td class="actions">
                  @if (d.status !== 'VERIFIED') {<button class="btn primary sm" (click)="set(d.id, 'VERIFIED')">Verify</button>}
                  @if (d.status !== 'SUSPENDED') {<button class="btn ghost sm danger" (click)="set(d.id, 'SUSPENDED')">Suspend</button>}
                </td>
              </tr>
            } @empty {<tr><td colspan="6" class="muted">No doctors in this list.</td></tr>}
          </tbody>
        </table>
      </div>
      <p class="muted small">Before verifying, confirm the registration number with the issuing medical council's public register.</p>
    </div>
  `,
})
export default class AdminPage implements OnInit {
  private api = inject(Api);
  stats = signal<Record<string, number> | null>(null);
  doctors = signal<Awaited<ReturnType<Api['adminDoctors']>>>([]);
  error = signal('');
  filter = 'PENDING';

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      const [s, d] = await Promise.all([this.api.adminStats(), this.api.adminDoctors(this.filter || undefined)]);
      this.stats.set(s);
      this.doctors.set(d);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async set(id: string, status: 'VERIFIED' | 'SUSPENDED') {
    const note = status === 'SUSPENDED' ? prompt('Reason for suspension') ?? undefined : undefined;
    try {
      await this.api.setDoctorStatus(id, status, note);
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
