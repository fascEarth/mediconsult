import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth, errorText } from '../core/auth';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="card pad auth-card" (ngSubmit)="submit()">
        <h1>Create your account</h1>
        <div class="grid-2">
          <label>First name<input name="firstName" [(ngModel)]="m.firstName" required autocomplete="given-name" /></label>
          <label>Last name<input name="lastName" [(ngModel)]="m.lastName" required autocomplete="family-name" /></label>
        </div>
        <label>Email<input name="email" type="email" [(ngModel)]="m.email" required autocomplete="email" /></label>
        <label>Mobile (optional)<input name="phone" type="tel" [(ngModel)]="m.phone" autocomplete="tel" placeholder="+91 98765 43210" /></label>
        <label>Password<input name="password" type="password" [(ngModel)]="m.password" required minlength="10" autocomplete="new-password" />
          <small class="muted">10+ characters with upper, lower case and a number</small></label>
        <label class="check"><input type="checkbox" name="terms" [(ngModel)]="terms" required />
          <span>I agree to the <a routerLink="/legal/terms" target="_blank">Terms</a> and <a routerLink="/legal/privacy" target="_blank">Privacy Policy</a>.</span></label>
        @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
        <button class="btn primary block" [disabled]="busy() || !terms">{{ busy() ? 'Creating…' : 'Create account' }}</button>
        <p class="muted small">Already registered? <a routerLink="/login">Sign in</a> · Doctor? <a routerLink="/register/doctor">Apply here</a></p>
      </form>
    </div>
  `,
})
export default class RegisterPage {
  private auth = inject(Auth);
  private router = inject(Router);
  m = { firstName: '', lastName: '', email: '', phone: '', password: '' };
  terms = false;
  busy = signal(false);
  error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.register({ ...this.m, phone: this.m.phone || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await this.router.navigateByUrl('/doctors');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
