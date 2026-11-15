import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import { type HealthSummary, type Medication, type Vital, type VitalType, VITALS, vitalText } from '../core/types';
import { LineChart, Sparkline } from '../shared/charts';

/** Common adult reference ranges, shown as a shaded band. Informational only. */
const BANDS: Partial<Record<VitalType, [number, number]>> = { HR: [60, 100], SPO2: [95, 100], TEMP: [36.1, 37.5], GLUCOSE: [70, 100] };

@Component({
  imports: [DatePipe, FormsModule, RouterLink, LineChart, Sparkline],
  template: `
    <div class="page">
      <div class="row-between">
        <div><h1>My health</h1><p class="muted">Track your readings and medicines. Your doctor can see your readings during a consultation.</p></div>
        <a class="btn" routerLink="/profile">Health profile &amp; records</a>
      </div>
      @if (error()) {<p class="error">{{ error() }}</p>}

      @if (summary(); as s) {
        <div class="snapshot">
          <div class="card pad snap next">
            <span class="muted small">Next consultation</span>
            @if (s.next) {
              <b>{{ s.next.startsAt | date: 'EEE d MMM, h:mm a' }}</b><span>{{ s.next.doctor }} · {{ s.next.specialty }}</span>
              <a [routerLink]="['/appointments', s.next.id]" class="small">View details →</a>
            } @else {<b>None booked</b><a routerLink="/doctors" class="small">Find a doctor →</a>}
          </div>
          @for (t of snapTypes; track t) {
            <button class="card pad snap" [class.active]="type() === t" (click)="select(t)">
              <span class="muted small">{{ VITALS[t].label }}</span>
              @if (s.latest[t]; as v) {
                <b>{{ text(v) }} <small class="muted">{{ VITALS[t].unit }}</small> @if (v.flag) {<span class="flag" [attr.data-f]="v.flag">{{ v.flag }}</span>}</b>
                <mc-sparkline [values]="spark(t)" [color]="v.flag ? '#b45309' : '#0f766e'" />
                <small class="muted">{{ v.recordedAt | date: 'd MMM' }}</small>
              } @else {<b class="muted">No readings</b>}
            </button>
          }
          <div class="card pad snap"><span class="muted small">Active medicines</span><b>{{ s.activeMedications }}</b><a href="#meds" class="small">See list ↓</a></div>
        </div>
      }

      <div class="two-col">
        <section class="card pad">
          <div class="row-between">
            <div class="tabs" role="tablist">
              @for (t of allTypes; track t) {<button role="tab" [class.active]="type() === t" [attr.aria-selected]="type() === t" (click)="select(t)">{{ VITALS[t].label }}</button>}
            </div>
            <select [ngModel]="days()" (ngModelChange)="setDays($event)" name="days" aria-label="Range" class="w-auto">
              <option [ngValue]="30">30 days</option><option [ngValue]="90">90 days</option><option [ngValue]="180">6 months</option><option [ngValue]="365">1 year</option>
            </select>
          </div>
          @if (filtered().length) {
            <mc-line-chart [labels]="labels()" [series]="series()" [band]="band()" [ariaLabel]="VITALS[type()].label + ' over time'" />
            <p class="muted small">@if (band()) {Shaded area: typical adult range{{ type() === 'GLUCOSE' ? ' (fasting)' : '' }}. } @if (type() === 'BP') {Typical adult blood pressure is below 120/80 mmHg. }Readings outside common ranges are flagged, not diagnosed. Talk to your doctor about what is right for you.</p>
            <table class="table">
              <thead><tr><th>Date</th><th>Reading</th><th></th><th></th></tr></thead>
              <tbody>
                @for (v of recent(); track v.id) {
                  <tr>
                    <td>{{ v.recordedAt | date: 'd MMM y, h:mm a' }}</td>
                    <td><b>{{ text(v) }}</b> {{ VITALS[v.type].unit }} @if (v.value['context']) {<span class="muted small">· {{ v.value['context'] }}</span>}</td>
                    <td>@if (v.flag) {<span class="flag" [attr.data-f]="v.flag">{{ v.flag }}</span>}</td>
                    <td class="right"><button class="link danger small" (click)="remove(v)">Delete</button></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {<p class="muted empty">No {{ VITALS[type()].label.toLowerCase() }} readings in this period. Log one to start your trend.</p>}
        </section>

        <aside class="card pad stack">
          <h3>Log a reading</h3>
          <label>Type
            <select [(ngModel)]="form.type" name="ft" (ngModelChange)="form.value = {}">
              @for (t of allTypes; track t) {<option [value]="t">{{ VITALS[t].label }}</option>}
            </select>
          </label>
          <div class="grid-2">
            @for (f of VITALS[form.type].fields; track f.key) {
              <label>{{ f.label }}<input type="number" [step]="f.step ?? 1" [(ngModel)]="form.value[f.key]" [name]="'f-' + f.key" required /></label>
            }
          </div>
          @if (form.type === 'GLUCOSE') {
            <label>When<select [(ngModel)]="form.context" name="ctx"><option value="fasting">Fasting</option><option value="post-meal">After a meal</option><option value="random">Random</option></select></label>
          }
          <label>Taken at<input type="datetime-local" [(ngModel)]="form.at" name="at" [max]="nowLocal()" /></label>
          @if (formError()) {<p class="error small">{{ formError() }}</p>}
          <button class="btn primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save reading' }}</button>
          <p class="muted small">Not for emergencies. If a reading worries you, contact a doctor or call 112.</p>
        </aside>
      </div>

      <h2 id="meds">Medicines</h2>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>Medicine</th><th>How to take</th><th>Prescribed</th><th>Until</th><th></th></tr></thead>
          <tbody>
            @for (m of meds(); track $index) {
              <tr [class.dim]="!m.active">
                <td><b>{{ m.medicine }}</b>@if (m.diagnosis) {<br /><small class="muted">{{ m.diagnosis }}</small>}</td>
                <td>{{ m.dosage }} · {{ m.frequency }}@if (m.instructions) {<br /><small class="muted">{{ m.instructions }}</small>}</td>
                <td>{{ m.issuedAt | date: 'd MMM y' }}<br /><small class="muted">{{ m.doctor }}</small></td>
                <td>{{ m.endsAt ? (m.endsAt | date: 'd MMM y') : m.duration }}</td>
                <td><span class="tag" [class.ok]="m.active">{{ m.active ? 'Active' : 'Completed' }}</span> <a class="small" [routerLink]="['/prescription', m.appointmentId]">℞</a></td>
              </tr>
            } @empty {<tr><td colspan="5" class="muted">No prescriptions yet. Medicines your doctor prescribes appear here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export default class HealthPage implements OnInit {
  private api = inject(Api);
  readonly VITALS = VITALS;
  readonly allTypes: VitalType[] = ['BP', 'HR', 'WEIGHT', 'GLUCOSE', 'SPO2', 'TEMP'];
  readonly snapTypes: VitalType[] = ['BP', 'HR', 'WEIGHT', 'GLUCOSE'];
  text = vitalText;

  summary = signal<HealthSummary | null>(null);
  vitals = signal<Vital[]>([]);
  meds = signal<Medication[]>([]);
  type = signal<VitalType>('BP');
  days = signal(90);
  error = signal('');
  formError = signal('');
  saving = signal(false);
  form: { type: VitalType; value: Record<string, number>; context: string; at: string } = { type: 'BP', value: {}, context: 'fasting', at: '' };

  filtered = computed(() => {
    const since = Date.now() - this.days() * 86_400_000;
    return this.vitals().filter((v) => v.type === this.type() && new Date(v.recordedAt).getTime() >= since);
  });
  labels = computed(() => this.filtered().map((v) => new Date(v.recordedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
  series = computed(() => {
    const t = this.type();
    if (t === 'BP') return [
      { name: 'Systolic', values: this.filtered().map((v) => Number(v.value['systolic'])), color: '#0f766e' },
      { name: 'Diastolic', values: this.filtered().map((v) => Number(v.value['diastolic'])), color: '#6366f1' },
    ];
    return [{ name: VITALS[t].label, values: this.filtered().map((v) => Number(v.value[VITALS[t].primary])) }];
  });
  band = computed(() => BANDS[this.type()] ?? null);
  recent = computed(() => [...this.filtered()].reverse().slice(0, 12));

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      const [s, v, m] = await Promise.all([this.api.healthSummary(), this.api.vitals({ days: 365 }), this.api.medications()]);
      this.summary.set(s);
      this.vitals.set(v);
      this.meds.set(m.sort((a, b) => Number(b.active) - Number(a.active)));
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  select(t: VitalType) {
    this.type.set(t);
    this.form = { ...this.form, type: t, value: {} };
  }

  setDays(d: number) {
    this.days.set(Number(d));
  }

  spark(t: VitalType) {
    return this.vitals().filter((v) => v.type === t).slice(-12).map((v) => Number(v.value[VITALS[t].primary]));
  }

  nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  async save() {
    this.formError.set('');
    const def = VITALS[this.form.type];
    const value: Record<string, number | string> = {};
    for (const f of def.fields) {
      const n = Number(this.form.value[f.key]);
      if (!Number.isFinite(n) || this.form.value[f.key] === undefined || this.form.value[f.key] === null) {
        this.formError.set(`Enter ${f.label.toLowerCase()}`);
        return;
      }
      value[f.key] = n;
    }
    if (this.form.type === 'GLUCOSE') value['context'] = this.form.context;
    this.saving.set(true);
    try {
      await this.api.addVital({ type: this.form.type, value, recordedAt: this.form.at ? new Date(this.form.at).toISOString() : undefined });
      this.form = { ...this.form, value: {}, at: '' };
      this.type.set(this.form.type);
      await this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(v: Vital) {
    if (!confirm('Delete this reading?')) return;
    try {
      await this.api.deleteVital(v.id);
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
