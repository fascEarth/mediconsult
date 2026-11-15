import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import { type AdminAnalytics, type AdminAppointment, type AppointmentStatus, type AuditEntry, STATUS_LABEL } from '../core/types';
import { BarChart, Donut, Kpi, LineChart } from '../shared/charts';
import { MoneyPipe, StatusBadge } from '../shared/ui';

type Tab = 'overview' | 'doctors' | 'consultations' | 'audit';

@Component({
  imports: [DatePipe, JsonPipe, FormsModule, RouterLink, MoneyPipe, StatusBadge, BarChart, LineChart, Donut, Kpi],
  template: `
    <div class="page">
      <div class="row-between">
        <h1>Admin console</h1>
        <div class="tabs" role="tablist">
          @for (t of tabs; track t.id) {<button role="tab" [class.active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="open(t.id)">{{ t.label }}@if (t.id === 'doctors' && (stats()?.['pendingDoctors'] ?? 0) > 0) {<span class="count">{{ stats()?.['pendingDoctors'] }}</span>}</button>}
        </div>
      </div>
      @if (error()) {<p class="error">{{ error() }}</p>}

      @switch (tab()) {
        @case ('overview') {
          @if (stats(); as s) {
            <div class="kpi-grid">
              <mc-kpi label="Patients" [value]="s['patients']" />
              <mc-kpi label="Verified doctors" [value]="s['doctors']" [hint]="s['pendingDoctors'] + ' awaiting verification'" />
              <mc-kpi label="Upcoming consultations" [value]="s['upcoming']" />
              <mc-kpi label="Completed (30 days)" [value]="s['completed30']" />
              <mc-kpi label="Revenue (30 days)" [value]="{ amountMinor: s['revenue30Minor'], currency: 'INR' } | money" />
            </div>
          }
          @if (analytics(); as a) {
            <div class="grid-2-wide">
              <section class="card pad">
                <div class="row-between"><h3>Bookings per day</h3><span class="muted small">last {{ a.days }} days</span></div>
                <mc-bar-chart [data]="bookingBars()" ariaLabel="Bookings per day" />
              </section>
              <section class="card pad">
                <div class="row-between"><h3>Revenue per day</h3><span class="muted small">INR</span></div>
                <mc-line-chart [labels]="dayLabels()" [series]="[{ name: 'Revenue', values: revenue() }]" ariaLabel="Revenue per day" />
              </section>
            </div>
            <div class="grid-3">
              <section class="card pad">
                <h3>Consultations by specialty</h3>
                <mc-donut [data]="specialtyData()" centerLabel="consults" />
              </section>
              <section class="card pad">
                <h3>Booking funnel</h3>
                <div class="funnel">
                  <div><span>Paid after booking</span><b>{{ a.conversionRate }}%</b><div class="dist-bar"><i [style.width.%]="a.conversionRate"></i></div></div>
                  <div><span>Cancelled</span><b>{{ a.cancellationRate }}%</b><div class="dist-bar warn"><i [style.width.%]="a.cancellationRate"></i></div></div>
                  <div><span>Refunded</span><b>{{ { amountMinor: a.refundsMinor, currency: 'INR' } | money }}</b></div>
                </div>
                <div class="status-chips">
                  @for (e of statusEntries(); track e.status) {<span class="tag">{{ label(e.status) }} · {{ e.count }}</span>}
                </div>
              </section>
              <section class="card pad">
                <h3>Top doctors</h3>
                <ol class="ranked">
                  @for (d of a.topDoctors; track d.id) {<li><span class="grow"><b>{{ d.name }}</b><small class="muted">{{ d.specialty }}</small></span><span class="right"><b>{{ d.consultations }}</b><small class="muted">{{ d.rating }} ★</small></span></li>}
                </ol>
              </section>
            </div>
          }
        }

        @case ('doctors') {
          <div class="row-between">
            <h2>Doctors</h2>
            <select [(ngModel)]="filter" (change)="loadDoctors()" name="f" aria-label="Status filter" class="w-auto">
              <option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="SUSPENDED">Suspended</option><option value="">All</option>
            </select>
          </div>
          <div class="card table-wrap">
            <table class="table">
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
                      @if (d.status !== 'VERIFIED') {<button class="btn primary sm" (click)="setStatus(d.id, 'VERIFIED')">Verify</button>}
                      @if (d.status !== 'SUSPENDED') {<button class="btn ghost sm danger" (click)="setStatus(d.id, 'SUSPENDED')">Suspend</button>}
                    </td>
                  </tr>
                } @empty {<tr><td colspan="6" class="muted">No doctors in this list.</td></tr>}
              </tbody>
            </table>
          </div>
          <p class="muted small">Before verifying, confirm the registration number with the issuing medical council's public register.</p>
        }

        @case ('consultations') {
          <div class="filters card">
            <input [(ngModel)]="search" name="q" placeholder="Search reference, patient or doctor" (keyup.enter)="loadAppts(1)" />
            <select [(ngModel)]="apptStatus" name="s" (change)="loadAppts(1)" aria-label="Status">
              <option value="">All statuses</option>
              @for (st of statuses; track st) {<option [value]="st">{{ label(st) }}</option>}
            </select>
            <button class="btn primary" (click)="loadAppts(1)">Search</button>
          </div>
          <div class="card table-wrap">
            <table class="table">
              <thead><tr><th>Reference</th><th>When</th><th>Patient</th><th>Doctor</th><th>Fee</th><th>Payment</th><th>Status</th></tr></thead>
              <tbody>
                @for (a of appts(); track a.id) {
                  <tr>
                    <td><a [routerLink]="['/appointments', a.id]">{{ a.reference }}</a></td>
                    <td>{{ a.startsAt | date: 'd MMM y, h:mm a' }}</td>
                    <td>{{ a.patient }}</td>
                    <td>{{ a.doctor }}<br /><small class="muted">{{ a.specialty }}</small></td>
                    <td>{{ a.fee | money }}</td>
                    <td>@if (a.payment) {<span class="tag" [class.ok]="a.payment === 'SUCCEEDED'">{{ a.payment === 'SUCCEEDED' ? 'Paid' : 'Refunded' }}</span>} @else {<span class="muted">—</span>}</td>
                    <td><mc-status [status]="a.status" /></td>
                  </tr>
                } @empty {<tr><td colspan="7" class="muted">No consultations match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <span class="muted small">{{ apptTotal() }} consultations · page {{ apptPage() }} of {{ pages() }}</span>
            <button class="btn sm" [disabled]="apptPage() <= 1" (click)="loadAppts(apptPage() - 1)">‹ Prev</button>
            <button class="btn sm" [disabled]="apptPage() >= pages()" (click)="loadAppts(apptPage() + 1)">Next ›</button>
          </div>
          <p class="muted small">Admins see consultation metadata only. Reasons, notes and prescriptions stay between patient and doctor.</p>
        }

        @case ('audit') {
          <div class="filters card">
            <input [(ngModel)]="auditEntity" name="ae" placeholder="Filter by record id (appointment, patient, doctor…)" (keyup.enter)="loadAudit()" />
            <button class="btn primary" (click)="loadAudit()">Filter</button>
          </div>
          <div class="card table-wrap">
            <table class="table small-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                @for (e of audit(); track e.id) {
                  <tr>
                    <td>{{ e.createdAt | date: 'd MMM, HH:mm:ss' }}</td>
                    <td><span class="tag">{{ e.actorRole ?? 'system' }}</span><br /><small class="muted mono">{{ e.actorId?.slice(-8) }}</small></td>
                    <td><code>{{ e.action }}</code></td>
                    <td>{{ e.entity }}<br /><button class="link small mono" (click)="auditEntity = e.entityId; loadAudit()">{{ e.entityId.slice(-10) }}</button></td>
                    <td>@if (e.meta) {<small class="muted mono">{{ e.meta | json }}</small>}</td>
                  </tr>
                } @empty {<tr><td colspan="5" class="muted">No audit entries.</td></tr>}
              </tbody>
            </table>
          </div>
          <p class="muted small">The audit log is append-only: every access to health information and every sensitive action is recorded and cannot be edited.</p>
        }
      }
    </div>
  `,
})
export default class AdminPage implements OnInit {
  private api = inject(Api);
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'doctors', label: 'Doctors' }, { id: 'consultations', label: 'Consultations' }, { id: 'audit', label: 'Audit log' },
  ];
  readonly statuses = Object.keys(STATUS_LABEL) as AppointmentStatus[];
  tab = signal<Tab>('overview');
  stats = signal<Record<string, number> | null>(null);
  analytics = signal<AdminAnalytics | null>(null);
  doctors = signal<Awaited<ReturnType<Api['adminDoctors']>>>([]);
  appts = signal<AdminAppointment[]>([]);
  apptTotal = signal(0);
  apptPage = signal(1);
  audit = signal<AuditEntry[]>([]);
  error = signal('');
  filter = 'PENDING';
  search = '';
  apptStatus = '';
  auditEntity = '';

  dayLabels = computed(() => (this.analytics()?.daily ?? []).map((d) => new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
  bookingBars = computed(() => (this.analytics()?.daily ?? []).map((d, i) => ({ label: this.dayLabels()[i], value: d.bookings })));
  revenue = computed(() => (this.analytics()?.daily ?? []).map((d) => Math.round(d.revenueMinor / 100)));
  specialtyData = computed(() => (this.analytics()?.bySpecialty ?? []).map((s) => ({ label: s.specialty, value: s.count })));
  statusEntries = computed(() => Object.entries(this.analytics()?.byStatus ?? {}).map(([status, count]) => ({ status: status as AppointmentStatus, count: count ?? 0 })));
  pages = computed(() => Math.max(1, Math.ceil(this.apptTotal() / 25)));

  async ngOnInit() {
    await this.open('overview');
  }

  label(s: AppointmentStatus) {
    return STATUS_LABEL[s];
  }

  async open(t: Tab) {
    this.tab.set(t);
    this.error.set('');
    try {
      if (t === 'overview') {
        const [s, a] = await Promise.all([this.api.adminStats(), this.api.adminAnalytics()]);
        this.stats.set(s);
        this.analytics.set(a);
      } else if (t === 'doctors') await this.loadDoctors();
      else if (t === 'consultations') await this.loadAppts(1);
      else await this.loadAudit();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async loadDoctors() {
    try {
      this.doctors.set(await this.api.adminDoctors(this.filter || undefined));
      if (!this.stats()) this.stats.set(await this.api.adminStats());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async loadAppts(page: number) {
    try {
      const r = await this.api.adminAppointments({ status: this.apptStatus || undefined, search: this.search || undefined, page });
      this.appts.set(r.items);
      this.apptTotal.set(r.total);
      this.apptPage.set(r.page);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async loadAudit() {
    try {
      this.audit.set(await this.api.adminAudit(this.auditEntity.trim() || undefined));
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async setStatus(id: string, status: 'VERIFIED' | 'SUSPENDED') {
    const note = status === 'SUSPENDED' ? prompt('Reason for suspension') ?? undefined : undefined;
    try {
      await this.api.setDoctorStatus(id, status, note);
      this.stats.set(await this.api.adminStats());
      await this.loadDoctors();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
