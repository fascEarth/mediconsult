import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import { type Vital, type VitalType, VITALS, vitalText } from '../core/types';
import { LineChart, Sparkline } from './charts';

/** Treating doctor's view of the patient's self-logged vitals (last 6 months). */
@Component({
  selector: 'mc-patient-vitals',
  imports: [DatePipe, LineChart, Sparkline],
  template: `
    <div class="card pad">
      <div class="row-between"><h3>Patient vitals <small class="muted">(self-reported)</small></h3>@if (bp().length) {<button class="link small" (click)="showChart.set(!showChart())">{{ showChart() ? 'Hide' : 'Show' }} BP trend</button>}</div>
      @if (error()) {<p class="muted small">{{ error() }}</p>}
      @if (tiles().length) {
        <div class="vital-tiles">
          @for (t of tiles(); track t.type) {
            <div class="vt">
              <span class="muted small">{{ VITALS[t.type].label }}</span>
              <b>{{ text(t.latest) }} <small class="muted">{{ VITALS[t.type].unit }}</small></b>
              @if (t.latest.flag) {<span class="flag" [attr.data-f]="t.latest.flag">{{ t.latest.flag }}</span>}
              <mc-sparkline [values]="t.values" [color]="t.latest.flag ? '#b45309' : '#0f766e'" />
              <small class="muted">{{ t.latest.recordedAt | date: 'd MMM' }} · {{ t.count }} readings</small>
            </div>
          }
        </div>
        @if (showChart()) {
          <mc-line-chart [labels]="bpLabels()" [series]="bpSeries()" [band]="[80, 120]" [height]="190" ariaLabel="Blood pressure trend" />
        }
      } @else if (!error()) {<p class="muted small">The patient hasn't logged any readings.</p>}
    </div>
  `,
})
export class PatientVitals {
  readonly appointmentId = input.required<string>();
  private api = inject(Api);
  readonly VITALS = VITALS;
  text = vitalText;
  vitals = signal<Vital[]>([]);
  error = signal('');
  showChart = signal(true);

  tiles = computed(() => {
    const order: VitalType[] = ['BP', 'HR', 'GLUCOSE', 'WEIGHT', 'SPO2', 'TEMP'];
    return order.map((type) => {
      const list = this.vitals().filter((v) => v.type === type);
      if (!list.length) return null;
      return { type, latest: list[list.length - 1], count: list.length, values: list.slice(-12).map((v) => Number(v.value[VITALS[type].primary])) };
    }).filter((t): t is NonNullable<typeof t> => !!t);
  });
  bp = computed(() => this.vitals().filter((v) => v.type === 'BP').slice(-30));
  bpLabels = computed(() => this.bp().map((v) => new Date(v.recordedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
  bpSeries = computed(() => [
    { name: 'Systolic', values: this.bp().map((v) => Number(v.value['systolic'])), color: '#0f766e' },
    { name: 'Diastolic', values: this.bp().map((v) => Number(v.value['diastolic'])), color: '#6366f1' },
  ]);

  constructor() {
    effect(() => {
      const id = this.appointmentId();
      void this.api.consultationVitals(id).then((v) => this.vitals.set(v)).catch((e) => this.error.set(errorText(e)));
    });
  }
}
