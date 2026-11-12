import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import type { Doctor, MedicalRecord } from '../core/types';
import { Avatar, MoneyPipe, Stars } from '../shared/ui';

interface Day {
  key: string;
  date: Date;
  slots: Date[];
}

@Component({
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe, Stars, Avatar],
  template: `
    @if (doctor(); as d) {
      <div class="page two-col">
        <section>
          <div class="card pad profile-head">
            <mc-avatar [name]="d.name" [src]="d.photoUrl" />
            <div>
              <h1>{{ d.name }}</h1>
              <p class="accent-text">{{ d.specialty }}</p>
              <p class="muted">{{ d.qualifications }} · {{ d.experienceYears }} years experience</p>
              <p><mc-stars [value]="d.rating.average" /> {{ d.rating.average }} <span class="muted">({{ d.rating.count }} reviews)</span></p>
              <p class="muted">Languages: {{ d.languages.join(', ') }}</p>
              @if (d.verified) {<span class="badge-ok">✓ Registration verified</span>}
            </div>
          </div>
          @if (d.bio) {<div class="card pad"><h3>About</h3><p>{{ d.bio }}</p></div>}
          @if (d.reviews?.length) {
            <div class="card pad"><h3>Patient reviews</h3>
              @for (r of d.reviews; track $index) {
                <div class="review"><mc-stars [value]="r.rating" /> @if (r.comment) {<p>{{ r.comment }}</p>}<small class="muted">{{ r.createdAt | date: 'mediumDate' }}</small></div>
              }
            </div>
          }
        </section>

        <aside class="card pad booking">
          <div class="row-between"><h3>Book a video consultation</h3><b>{{ d.fee | money }}</b></div>
          <p class="muted small">{{ d.slotMinutes }} min · times shown in your timezone ({{ tz }})</p>
          <div class="days" role="tablist">
            @for (day of days(); track day.key) {
              <button class="day" role="tab" [class.active]="day.key === activeDay()" (click)="activeDay.set(day.key)" [disabled]="!day.slots.length">
                <small>{{ day.date | date: 'EEE' }}</small><b>{{ day.date | date: 'd MMM' }}</b><small>{{ day.slots.length }} slots</small>
              </button>
            }
          </div>
          <div class="slots">
            @for (s of activeSlots(); track s.getTime()) {
              <button class="slot" [class.active]="selected()?.getTime() === s.getTime()" (click)="selected.set(s)">{{ s | date: 'shortTime' }}</button>
            } @empty { <p class="muted">No free slots this day.</p> }
          </div>

          @if (selected()) {
            <form class="book-form" (ngSubmit)="book()">
              <label>What would you like to discuss?
                <textarea name="reason" [(ngModel)]="reason" rows="3" maxlength="1000" required placeholder="Symptoms, how long, any medicines you take"></textarea>
              </label>
              @if (records().length) {
                <fieldset><legend>Share reports with the doctor (optional)</legend>
                  @for (r of records(); track r.id) {
                    <label class="check"><input type="checkbox" [checked]="shared.has(r.id)" (change)="toggle(r.id)" /> {{ r.title }}</label>
                  }
                </fieldset>
              }
              <label class="check"><input type="checkbox" name="consent" [(ngModel)]="consent" required />
                <span>I agree to the <a routerLink="/legal/telemedicine" target="_blank">telemedicine consent</a> and understand this is not for emergencies.</span></label>
              @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
              <button class="btn primary block" [disabled]="busy() || !consent || reason.trim().length < 3">
                {{ busy() ? 'Reserving…' : 'Continue · ' + (selected() | date: 'EEE d MMM, h:mm a') }}
              </button>
            </form>
          }
        </aside>
      </div>
    } @else if (error()) {
      <div class="page"><p class="error">{{ error() }}</p><a routerLink="/doctors">Back to doctors</a></div>
    }
  `,
})
export default class DoctorPage {
  readonly id = input.required<string>();
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  doctor = signal<Doctor | null>(null);
  days = signal<Day[]>([]);
  activeDay = signal('');
  selected = signal<Date | null>(null);
  records = signal<MedicalRecord[]>([]);
  error = signal('');
  busy = signal(false);
  activeSlots = computed(() => this.days().find((d) => d.key === this.activeDay())?.slots ?? []);
  shared = new Set<string>();
  reason = '';
  consent = false;

  constructor() {
    effect(() => void this.load(this.id()));
  }

  private async load(id: string) {
    try {
      this.doctor.set(await this.api.doctor(id));
      const { slots } = await this.api.slots(id, new Date().toISOString(), 7);
      const byDay = new Map<string, Day>();
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        byDay.set(d.toDateString(), { key: d.toDateString(), date: d, slots: [] });
      }
      for (const iso of slots) {
        const s = new Date(iso);
        byDay.get(s.toDateString())?.slots.push(s);
      }
      const days = [...byDay.values()];
      this.days.set(days);
      this.activeDay.set(days.find((d) => d.slots.length)?.key ?? days[0].key);
      if (this.auth.role() === 'PATIENT') this.records.set(await this.api.records().catch(() => []));
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  toggle(id: string) {
    if (this.shared.has(id)) this.shared.delete(id);
    else this.shared.add(id);
  }

  async book() {
    if (this.auth.role() !== 'PATIENT') {
      await this.router.navigate(['/login'], { queryParams: { next: `/doctors/${this.id()}` } });
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const appt = await this.api.book({ doctorId: this.id(), startsAt: this.selected()!.toISOString(), reason: this.reason, consent: true, recordIds: [...this.shared] });
      await this.router.navigate(appt.status === 'PENDING_PAYMENT' ? ['/checkout', appt.id] : ['/appointments', appt.id]);
    } catch (e) {
      this.error.set(errorText(e));
      void this.load(this.id());
    } finally {
      this.busy.set(false);
    }
  }
}
