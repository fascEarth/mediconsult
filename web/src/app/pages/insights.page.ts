import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import type { DoctorInsights } from '../core/types';
import { BarChart, Heatmap, Kpi, LineChart } from '../shared/charts';
import { MoneyPipe, StatusBadge, Stars } from '../shared/ui';

@Component({
  imports: [DatePipe, RouterLink, BarChart, LineChart, Heatmap, Kpi, MoneyPipe, StatusBadge, Stars],
  template: `
    <div class="page">
      <div class="row-between">
        <div>
          <h1>Practice insights</h1>
          <p class="muted">Your consultations, earnings and patient feedback. Times in {{ data()?.timezone }}.</p>
        </div>
        <a class="btn" routerLink="/dashboard">Open schedule</a>
      </div>
      @if (error()) {<p class="error">{{ error() }}</p>}
      @if (data(); as d) {
        <div class="kpi-grid">
          <mc-kpi label="Consultations this month" [value]="d.kpis.consultationsThisMonth" [change]="d.kpis.consultationsChange" changeLabel="vs same days last month" />
          <mc-kpi label="Earnings this month" [value]="{ amountMinor: d.kpis.earningsThisMonthMinor, currency: d.currency } | money" [change]="d.kpis.earningsChange" changeLabel="vs same days last month" />
          <mc-kpi label="Rating" [value]="d.kpis.rating + ' ★'" [hint]="d.kpis.ratingCount + ' reviews'" />
          <mc-kpi label="No-show rate (12 weeks)" [value]="d.kpis.noShowRate + '%'" hint="Patients who missed their slot" />
          <mc-kpi label="Patients seen" [value]="d.kpis.uniquePatients" [hint]="d.kpis.repeatPatientRate + '% came back'" />
        </div>

        <div class="grid-2-wide">
          <section class="card pad">
            <div class="row-between"><h3>Consultations per week</h3><span class="muted small">last 12 weeks</span></div>
            <mc-bar-chart [data]="weeklyBars()" ariaLabel="Completed consultations per week" />
          </section>
          <section class="card pad">
            <div class="row-between"><h3>Earnings per week</h3><span class="muted small">{{ d.currency }}</span></div>
            <mc-line-chart [labels]="weekLabels()" [series]="[{ name: 'Earnings', values: earnings() }]" ariaLabel="Earnings per week" />
          </section>
        </div>

        <div class="grid-2-wide">
          <section class="card pad">
            <div class="row-between"><h3>Today</h3><span class="muted small">{{ d.today.length }} consultations</span></div>
            <div class="list compact">
              @for (a of d.today; track a.id) {
                <a class="appt-row" [routerLink]="['/appointments', a.id]">
                  <b class="time">{{ a.startsAt | date: 'h:mm a' }}</b><span class="grow">{{ a.patient }}</span><mc-status [status]="a.status" />
                </a>
              } @empty {<p class="muted">No consultations today.</p>}
            </div>
          </section>
          <section class="card pad">
            <h3>When patients book you</h3>
            <mc-heatmap [matrix]="d.heatmap" />
            <p class="muted small">Darker cells are busier hours. Use this to plan availability in <a routerLink="/doctor/settings">practice settings</a>.</p>
          </section>
        </div>

        <div class="grid-2-wide">
          <section class="card pad">
            <h3>Rating breakdown</h3>
            @for (r of d.ratingDistribution; track r.rating) {
              <div class="dist-row"><span>{{ r.rating }} ★</span><div class="dist-bar"><i [style.width.%]="pct(r.count)"></i></div><span class="muted">{{ r.count }}</span></div>
            }
          </section>
          <section class="card pad">
            <h3>Recent reviews</h3>
            @for (r of d.recentReviews; track $index) {
              <div class="review"><div class="row-between"><mc-stars [value]="r.rating" /><small class="muted">{{ r.patient }} · {{ r.createdAt | date: 'd MMM' }}</small></div>@if (r.comment) {<p>{{ r.comment }}</p>}</div>
            } @empty {<p class="muted">No reviews yet.</p>}
          </section>
        </div>
      } @else if (!error()) {
        <div class="kpi-grid">@for (i of [1,2,3,4,5]; track i) {<div class="card skeleton kpi"></div>}</div>
      }
    </div>
  `,
})
export default class InsightsPage implements OnInit {
  private api = inject(Api);
  data = signal<DoctorInsights | null>(null);
  error = signal('');

  weekLabels = computed(() => (this.data()?.weekly ?? []).map((w) => new Date(w.week + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
  weeklyBars = computed(() => (this.data()?.weekly ?? []).map((w, i) => ({ label: this.weekLabels()[i], value: w.consultations, title: `Week of ${this.weekLabels()[i]}: ${w.consultations} consultations, ${w.noShows} no-shows` })));
  earnings = computed(() => (this.data()?.weekly ?? []).map((w) => Math.round(w.earningsMinor / 100)));
  private maxRating = computed(() => Math.max(1, ...(this.data()?.ratingDistribution ?? []).map((r) => r.count)));

  async ngOnInit() {
    try {
      this.data.set(await this.api.doctorInsights());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  pct(n: number) {
    return Math.round((n / this.maxRating()) * 100);
  }
}
