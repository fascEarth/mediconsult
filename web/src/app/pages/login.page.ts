import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <form class="card pad auth-card" (ngSubmit)="submit()">
        <h1>Welcome back</h1>
        <label>Email<input name="email" type="email" [(ngModel)]="email" required autocomplete="username" /></label>
        <label>Password<input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" /></label>
        @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
        <button class="btn primary block" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <p class="muted small">New here? <a routerLink="/register">Create an account</a></p>
        @if (api.publicConfig()?.demoMode) {
          <div class="demo-accounts">
            <b>Demo accounts</b>
            <button type="button" class="link" (click)="fill('patient@mediconsult.demo', 'Patient@12345')">Patient</button>
            <button type="button" class="link" (click)="fill('doctor@mediconsult.demo', 'Doctor@12345')">Doctor</button>
            <button type="button" class="link" (click)="fill('admin@mediconsult.demo', 'Admin@12345')">Admin</button>
          </div>
          <p class="muted small">Tip: sign in as the patient in one tab and the doctor in another, then open the consultation to chat live. Data stays in your browser.</p>
        }
      </form>
    </div>
  `,
})
export default class LoginPage {
  readonly next = input<string>();
  api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  email = '';
  password = '';
  busy = signal(false);
  error = signal('');

  fill(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email, this.password);
      const next = this.next();
      await this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : this.auth.home());
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
