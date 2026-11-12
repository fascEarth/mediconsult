import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth, errorText } from '../core/auth';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="card pad auth-card wide" (ngSubmit)="submit()">
        <h1>Join MediConsult as a doctor</h1>
        <p class="muted">We verify your medical council registration before your profile goes live (usually within 2 working days).</p>
        <div class="grid-2">
          <label>First name<input name="firstName" [(ngModel)]="m.firstName" required /></label>
          <label>Last name<input name="lastName" [(ngModel)]="m.lastName" required /></label>
          <label>Email<input name="email" type="email" [(ngModel)]="m.email" required autocomplete="email" /></label>
          <label>Mobile<input name="phone" type="tel" [(ngModel)]="m.phone" /></label>
          <label>Specialty<input name="specialty" [(ngModel)]="m.specialty" required placeholder="e.g. Dermatology" /></label>
          <label>Qualifications<input name="qualifications" [(ngModel)]="m.qualifications" required placeholder="MBBS, MD (Dermatology)" /></label>
          <label>Registration number<input name="registrationNumber" [(ngModel)]="m.registrationNumber" required /></label>
          <label>Registration council<input name="registrationCouncil" [(ngModel)]="m.registrationCouncil" required placeholder="e.g. Tamil Nadu Medical Council" /></label>
          <label>Years of experience<input name="experienceYears" type="number" min="0" [(ngModel)]="m.experienceYears" required /></label>
          <label>Consultation fee (₹)<input name="fee" type="number" min="0" [(ngModel)]="fee" required /></label>
        </div>
        <label>Languages (comma separated)<input name="languages" [(ngModel)]="languages" required placeholder="English, Tamil" /></label>
        <label>Short bio<textarea name="bio" [(ngModel)]="m.bio" rows="3" maxlength="2000"></textarea></label>
        <label>Password<input name="password" type="password" [(ngModel)]="m.password" required minlength="10" autocomplete="new-password" /></label>
        <label class="check"><input type="checkbox" name="declare" [(ngModel)]="declare" required /><span>I confirm these details are accurate and I hold a valid registration to practise.</span></label>
        @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
        <button class="btn primary block" [disabled]="busy() || !declare">{{ busy() ? 'Submitting…' : 'Submit application' }}</button>
        <p class="muted small"><a routerLink="/login">Already applied? Sign in</a></p>
      </form>
    </div>
  `,
})
export default class RegisterDoctorPage {
  private auth = inject(Auth);
  private router = inject(Router);
  m = { firstName: '', lastName: '', email: '', phone: '', password: '', specialty: '', qualifications: '', registrationNumber: '', registrationCouncil: '', experienceYears: 0, bio: '' };
  fee = 500;
  languages = 'English';
  declare = false;
  busy = signal(false);
  error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.register(
        {
          ...this.m, phone: this.m.phone || undefined, bio: this.m.bio || undefined, experienceYears: Number(this.m.experienceYears),
          feeMinor: Math.round(Number(this.fee) * 100), languages: this.languages.split(',').map((l) => l.trim()).filter(Boolean),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        true,
      );
      await this.router.navigateByUrl('/doctor/settings');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
