import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <section class="hero">
      <div class="hero-text">
        <h1>See a verified doctor online, <span class="accent">in minutes.</span></h1>
        <p class="lead">Private video consultations, digital prescriptions and your health records in one secure place.</p>
        <form class="search-bar" (ngSubmit)="search()">
          <input name="q" [(ngModel)]="q" placeholder="Search a specialty or doctor, e.g. Dermatology" aria-label="Search doctors" />
          <button class="btn primary">Find doctors</button>
        </form>
        <ul class="trust">
          <li>✓ Registration-verified doctors</li><li>✓ Encrypted records &amp; chat</li><li>✓ Prescriptions you can download</li>
        </ul>
      </div>
      <div class="hero-card card">
        <div class="pulse"></div>
        <b>How it works</b>
        <ol>
          <li>Choose a doctor and a time that suits you</li>
          <li>Pay securely and share reports (optional)</li>
          <li>Join the video call from your browser, with no app needed</li>
          <li>Get your e-prescription and follow-up chat</li>
        </ol>
      </div>
    </section>

    <section class="section">
      <h2>Browse by specialty</h2>
      <div class="chips">
        @for (s of specialties(); track s.specialty) {
          <a class="chip" [routerLink]="['/doctors']" [queryParams]="{ specialty: s.specialty }">{{ s.specialty }} <small>{{ s.doctors }}</small></a>
        } @empty { <span class="muted">Loading specialties…</span> }
      </div>
    </section>

    <section class="section grid-3">
      <div class="card pad"><h3>🔒 Private by design</h3><p class="muted">Clinical notes, prescriptions, chat and uploaded reports are encrypted at rest. Every access is audit-logged.</p></div>
      <div class="card pad"><h3>🩺 Verified doctors</h3><p class="muted">We check each doctor's medical council registration before their profile goes live.</p></div>
      <div class="card pad"><h3>🌍 Any timezone</h3><p class="muted">Slots appear in your local time. The doctor sees them in theirs.</p></div>
    </section>
  `,
})
export default class HomePage implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  specialties = signal<{ specialty: string; doctors: number }[]>([]);
  q = '';

  async ngOnInit() {
    this.specialties.set(await this.api.specialties().catch(() => []));
  }

  search() {
    void this.router.navigate(['/doctors'], { queryParams: { search: this.q || null } });
  }
}
