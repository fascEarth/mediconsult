import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from './core/api';
import { Auth } from './core/auth';
import { environment } from '../environments/environment';
import { NotificationBell } from './shared/notifications';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBell],
  template: `
    @if (api.publicConfig()?.demoMode) {
      <div class="demo-bar" role="note">Demo environment · fictional doctors · no real payments · do not enter real health information</div>
    }
    <header class="nav">
      <a routerLink="/" class="logo"><span class="mark">+</span> MediConsult</a>
      <nav [class.open]="open()" (click)="open.set(false)">
        <a routerLink="/doctors" routerLinkActive="active">Find a doctor</a>
        @switch (auth.role()) {
          @case ('PATIENT') {
            <a routerLink="/dashboard" routerLinkActive="active">My consultations</a>
            <a routerLink="/health" routerLinkActive="active">My health</a>
            <a routerLink="/profile" routerLinkActive="active">Profile</a>
          }
          @case ('DOCTOR') {
            <a routerLink="/dashboard" routerLinkActive="active">Schedule</a>
            <a routerLink="/doctor/insights" routerLinkActive="active">Insights</a>
            <a routerLink="/doctor/settings" routerLinkActive="active">Practice settings</a>
          }
          @case ('ADMIN') { <a routerLink="/admin" routerLinkActive="active">Admin</a> }
        }
        @if (auth.user(); as u) {
          <span class="muted hide-sm">{{ u.firstName }}</span>
          <button class="btn ghost" (click)="auth.logout()">Sign out</button>
        } @else {
          <a routerLink="/login" class="btn ghost">Sign in</a>
          <a routerLink="/register" class="btn primary">Get started</a>
        }
      </nav>
      <div class="nav-end">
        @if (auth.user()) {<mc-notifications />}
        <button class="menu-btn" (click)="open.set(!open())" aria-label="Menu">☰</button>
      </div>
    </header>
    <main><router-outlet /></main>
    <footer class="foot">
      <div>© {{ year }} MediConsult by Fascinora</div>
      <div class="links"><a routerLink="/legal/privacy">Privacy</a><a routerLink="/legal/terms">Terms</a><a routerLink="/legal/telemedicine">Telemedicine consent</a><a routerLink="/register/doctor">Join as a doctor</a>@if (demo) {<button class="link" (click)="resetDemo()">Reset demo data</button>}</div>
      <p class="muted small">Not for emergencies. If you have a medical emergency, call your local emergency number (112 in India) immediately.</p>
    </footer>
  `,
})
export class App implements OnInit {
  api = inject(Api);
  auth = inject(Auth);
  open = signal(false);
  year = new Date().getFullYear();
  demo = environment.demo;

  async resetDemo() {
    if (!confirm('Reset all demo data in this browser?')) return;
    (await import('./demo/medi-demo-backend')).resetDemo();
    sessionStorage.clear();
    location.href = '/';
  }

  ngOnInit() {
    void this.api.loadConfig().catch(() => undefined);
  }
}
