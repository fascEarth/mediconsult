import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import type { Prescription } from '../core/types';

@Component({
  imports: [DatePipe, RouterLink],
  template: `
    <div class="page narrow">
      <div class="row-between no-print">
        <a [routerLink]="['/appointments', id()]">← Back</a>
        <button class="btn primary" (click)="print()">Print / Save as PDF</button>
      </div>
      @if (p(); as p) {
        <article class="rx card pad">
          <header class="rx-head">
            <div>
              <h2>{{ p.doctor.name }}</h2>
              <p>{{ p.doctor.qualifications }} · {{ p.doctor.specialty }}</p>
              <p class="small">Reg. No. {{ p.doctor.registrationNumber }} · {{ p.doctor.registrationCouncil }}</p>
            </div>
            <div class="right"><b>MediConsult</b><p class="small">Ref {{ p.reference }}</p><p class="small">{{ p.issuedAt | date: 'd MMM y' }}</p></div>
          </header>
          <section class="rx-patient">
            <span><b>Patient:</b> {{ p.patient.name }}</span>
            @if (p.patient.dateOfBirth) {<span><b>DOB:</b> {{ p.patient.dateOfBirth | date: 'd MMM y' }}</span>}
            @if (p.patient.gender) {<span><b>Sex:</b> {{ p.patient.gender }}</span>}
          </section>
          <p><b>Diagnosis:</b> {{ p.diagnosis }}</p>
          <h3 class="rx-symbol">℞</h3>
          <table class="rx-table">
            <thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
            <tbody>
              @for (it of p.items; track $index) {
                <tr><td>{{ $index + 1 }}</td><td><b>{{ it.medicine }}</b></td><td>{{ it.dosage }}</td><td>{{ it.frequency }}</td><td>{{ it.duration }}</td><td>{{ it.instructions }}</td></tr>
              }
            </tbody>
          </table>
          @if (p.advice) {<p><b>Advice:</b> {{ p.advice }}</p>}
          @if (p.followUpDays) {<p><b>Follow up:</b> in {{ p.followUpDays }} days</p>}
          <footer class="rx-foot small muted">
            Issued electronically after a teleconsultation. Valid without signature when verified with reference {{ p.reference }}.
            Not valid for controlled/scheduled drugs that require an in-person examination.
          </footer>
        </article>
      } @else if (error()) {<p class="error">{{ error() }}</p>}
    </div>
  `,
})
export default class PrescriptionPage {
  readonly id = input.required<string>();
  private api = inject(Api);
  p = signal<Prescription | null>(null);
  error = signal('');

  constructor() {
    effect(() => {
      void this.api.prescription(this.id()).then((p) => this.p.set(p)).catch((e) => this.error.set(errorText(e)));
    });
  }

  print() {
    window.print();
  }
}
