import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import type { Appointment } from '../core/types';
import { StatusBadge } from '../shared/ui';

@Component({
  imports: [RouterLink, DatePipe, StatusBadge],
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
  isDoctor = () => this.auth.role() === 'DOCTOR';

  async ngOnInit() {
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
