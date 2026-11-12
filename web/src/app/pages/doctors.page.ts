import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { errorText } from '../core/auth';
import type { Doctor } from '../core/types';
import { Avatar, MoneyPipe, Stars } from '../shared/ui';

const LANGUAGES = ['English', 'Tamil', 'Hindi', 'Malayalam', 'Kannada', 'Telugu', 'Gujarati', 'Urdu', 'Mandarin'];

@Component({
  imports: [FormsModule, RouterLink, MoneyPipe, Stars, Avatar],
  template: `
    <div class="page">
      <h1>Find a doctor</h1>
      <form class="filters card" (ngSubmit)="apply()">
        <input name="search" [(ngModel)]="f.search" placeholder="Name or specialty" aria-label="Search" />
        <select name="specialty" [(ngModel)]="f.specialty" aria-label="Specialty">
          <option value="">All specialties</option>
          @for (s of specialties(); track s.specialty) {<option [value]="s.specialty">{{ s.specialty }}</option>}
        </select>
        <select name="language" [(ngModel)]="f.language" aria-label="Language">
          <option value="">Any language</option>
          @for (l of languages; track l) {<option [value]="l">{{ l }}</option>}
        </select>
        <button class="btn primary">Search</button>
      </form>

      @if (error()) {<p class="error">{{ error() }}</p>}
      <p class="muted">{{ total() }} doctors available</p>
      <div class="doctor-grid">
        @for (d of doctors(); track d.id) {
          <a class="card doctor-card" [routerLink]="['/doctors', d.id]">
            <mc-avatar [name]="d.name" [src]="d.photoUrl" />
            <div class="dc-body">
              <b>{{ d.name }}</b>
              <span class="accent-text">{{ d.specialty }}</span>
              <small class="muted">{{ d.qualifications }} · {{ d.experienceYears }} yrs</small>
              <small class="muted">Speaks {{ d.languages.join(', ') }}</small>
              <div class="row-between"><span><mc-stars [value]="d.rating.average" /> <small class="muted">({{ d.rating.count }})</small></span><b>{{ d.fee | money }}</b></div>
            </div>
          </a>
        } @empty {
          @if (!loading()) {<p class="muted">No doctors match these filters.</p>}
        }
      </div>
    </div>
  `,
})
export default class DoctorsPage {
  readonly specialty = input<string>();
  readonly search = input<string>();
  readonly language = input<string>();
  private api = inject(Api);
  private router = inject(Router);
  languages = LANGUAGES;
  specialties = signal<{ specialty: string; doctors: number }[]>([]);
  doctors = signal<Doctor[]>([]);
  total = signal(0);
  loading = signal(true);
  error = signal('');
  f = { search: '', specialty: '', language: '' };

  constructor() {
    void this.api.specialties().then((s) => this.specialties.set(s)).catch(() => undefined);
    effect(() => {
      this.f = { search: this.search() ?? '', specialty: this.specialty() ?? '', language: this.language() ?? '' };
      void this.load();
    });
  }

  apply() {
    void this.router.navigate([], { queryParams: { search: this.f.search || null, specialty: this.f.specialty || null, language: this.f.language || null } });
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.doctors(this.f);
      this.doctors.set(r.items);
      this.total.set(r.total);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.loading.set(false);
    }
  }
}
