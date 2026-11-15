import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import { type Appointment, type DoctorInsights, type HealthSummary, VITALS, vitalText } from '../core/types';
import { Kpi } from '../shared/charts';
import { MoneyPipe, StatusBadge } from '../shared/ui';

@Component({
  imports: [RouterLink, DatePipe, StatusBadge, Kpi, MoneyPipe],
  template: `
    <div class="page">
      <div class="row-between">
        <h1>{{ isDoctor() ? 'Your schedule' : 'My consultations' }}</h1>
        @if (!isDoctor()) {<a class="btn primary" routerLink="/doctors">Book a consultation</a>}
      </div>
      @if (isDoctor() && auth.user()?.doctorStatus !== 'VERIFIED') {
        <div class="banner">Your profile is <b>{{ auth.user()?.doctorStatus?.toLowerCase() }}</b>. Patients can book you once an admin verifies your registration. Meanwhile, <a routerLink="/doctor/settings">set your availability</a>.</div>
      }
      @if (error()) {<p class="error">{{ error() }}</p>}

      @if (health(); as h) {
        <div class="kpi-grid">
          <mc-kpi label="Next consultation" [value]="h.next ? (h.next.startsAt | date: 'EEE d MMM, h:mm a') ?? '' : 'None booked'" [hint]="h.next ? h.next.doctor : 'Book when you need one'" />
          <mc-kpi label="Blood pressure" [value]="h.latest.BP ? text(h.latest.BP) + ' mmHg' : '—'" [hint]="h.latest.BP ? (h.latest.BP.flag ? 'Last reading ' + h.latest.BP.flag : 'Last reading in range') : 'No readings yet'" />
          <mc-kpi label="Active medicines" [value]="h.activeMedications" hint="From your prescriptions" />
          <mc-kpi label="Consultations" [value]="h.consultations" [hint]="h.records + ' health records stored'" />
        </div>
        <p class="small"><a routerLink="/health">Open My health →</a> Track blood pressure, sugar, weight and more; your doctor sees them during a consultation.</p>
      }
      @if (insights(); as d) {
        <div class="kpi-grid">
          <mc-kpi label="Today" [value]="d.today.length + ' consultations'" [hint]="todayDone() + ' completed'" />
          <mc-kpi label="This month" [value]="d.kpis.consultationsThisMonth" [change]="d.kpis.consultationsChange" changeLabel="vs last month" />
          <mc-kpi label="Earnings this month" [value]="{ amountMinor: d.kpis.earningsThisMonthMinor, currency: d.currency } | money" [change]="d.kpis.earningsChange" changeLabel="vs last month" />
          <mc-kpi label="Rating" [value]="d.kpis.rating + ' ★'" [hint]="d.kpis.ratingCount + ' reviews'" />
        </div>
        <p class="small"><a routerLink="/doctor/insights">See practice insights →</a></p>
      }

      <h2>Upcoming</h2>
      <div class="list">
        @for (a of upcoming(); track a.id) {
          <a class="card appt" [routerLink]="['/appointments', a.id]">
            <div class="when"><b>{{ a.startsAt | date: 'd MMM' }}</b><span>{{ a.startsAt | date: 'h:mm a' }}</span></div>
            <div class="grow">
              <b>{{ isDoctor() ? a.patient.name : a.doctor.name }}</b>
              <small class="muted">{{ isDoctor() ? a.reason : a.doctor.specialty }}</small>
            </div>
            <mc-status [status]="a.status" />
            @if (joinable(a)) {<span class="btn primary sm">Join</span>}
          </a>
        } @empty { <p class="muted">Nothing scheduled.</p> }
      </div>

      <h2>Past</h2>
      <div class="list">
        @for (a of past(); track a.id) {
          <a class="card appt" [routerLink]="['/appointments', a.id]">
            <div class="when"><b>{{ a.startsAt | date: 'd MMM' }}</b><span>{{ a.startsAt | date: 'y' }}</span></div>
            <div class="grow"><b>{{ isDoctor() ? a.patient.name : a.doctor.name }}</b><small class="muted">{{ a.reference }}</small></div>
            @if (a.hasPrescription) {<span class="tag">℞ Prescription</span>}
            <mc-status [status]="a.status" />
          </a>
        } @empty { <p class="muted">No past consultations.</p> }
      </div>
    </div>
  `,
})
export default class DashboardPage implements OnInit {
  auth = inject(Auth);
  private api = inject(Api);
  upcoming = signal<Appointment[]>([]);
  past = signal<Appointment[]>([]);
  error = signal('');
  health = signal<HealthSummary | null>(null);
  insights = signal<DoctorInsights | null>(null);
  isDoctor = () => this.auth.role() === 'DOCTOR';
  text = vitalText;
  vitalsMeta = VITALS;
  todayDone = () => (this.insights()?.today ?? []).filter((a) => a.status === 'COMPLETED').length;

  async ngOnInit() {
    if (this.isDoctor()) void this.api.doctorInsights().then((d) => this.insights.set(d)).catch(() => undefined);
    else void this.api.healthSummary().then((h) => this.health.set(h)).catch(() => undefined);
    try {
      const [u, p] = await Promise.all([this.api.appointments('upcoming'), this.api.appointments('past')]);
      this.upcoming.set(u);
      this.past.set(p);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  joinable(a: Appointment) {
    return ['CONFIRMED', 'IN_PROGRESS'].includes(a.status) && Date.now() >= new Date(a.canJoinFrom).getTime();
  }
}
