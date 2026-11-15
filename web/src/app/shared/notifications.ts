import { Component, DestroyRef, effect, ElementRef, HostListener, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import type { AppNotification } from '../core/types';

const ICONS: Record<string, string> = {
  'appointment.confirmed': '✓', 'appointment.booked': '＋', 'appointment.cancelled': '✕', 'appointment.reminder': '⏰',
  'appointment.completed': '★', 'prescription.issued': '℞', 'review.received': '★', 'doctor.verified': '✓', 'doctor.suspended': '!',
};

/** Bell with unread count; polls while signed in and when the tab regains focus. */
@Component({
  selector: 'mc-notifications',
  imports: [DatePipe],
  template: `
    <button class="bell" (click)="toggle($event)" [attr.aria-expanded]="open()" [attr.aria-label]="unread() ? unread() + ' unread notifications' : 'Notifications'">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>
      @if (unread()) {<span class="badge">{{ unread() > 9 ? '9+' : unread() }}</span>}
    </button>
    @if (open()) {
      <div class="notif-panel card" role="dialog" aria-label="Notifications" (click)="$event.stopPropagation()">
        <div class="row-between notif-head"><b>Notifications</b>@if (unread()) {<button class="link small" (click)="readAll()">Mark all as read</button>}</div>
        <div class="notif-list">
          @for (n of items(); track n.id) {
            <button class="notif" [class.unread]="!n.readAt" (click)="go(n)">
              <span class="ni">{{ icon(n.type) }}</span>
              <span class="grow"><b>{{ n.title }}</b><small>{{ n.body }}</small><small class="muted">{{ n.createdAt | date: 'd MMM, h:mm a' }}</small></span>
            </button>
          } @empty {<p class="muted pad">You're all caught up.</p>}
        </div>
      </div>
    }
  `,
  host: { class: 'notif-host' },
})
export class NotificationBell {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  private el = inject(ElementRef<HTMLElement>);
  open = signal(false);
  items = signal<AppNotification[]>([]);
  unread = signal(0);
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      clearInterval(this.timer);
      if (!this.auth.user()) {
        this.items.set([]);
        this.unread.set(0);
        return;
      }
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 45_000);
    });
    const onFocus = () => this.auth.user() && void this.refresh();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      window.removeEventListener('focus', onFocus);
    });
  }

  @HostListener('document:click', ['$event'])
  outside(e: Event) {
    if (this.open() && !this.el.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  esc() {
    this.open.set(false);
  }

  icon(type: string) {
    return ICONS[type] ?? '•';
  }

  async refresh() {
    try {
      const r = await this.api.notifications();
      this.items.set(r.items);
      this.unread.set(r.unread);
    } catch {
      /* offline or signed out: keep last state */
    }
  }

  toggle(e: Event) {
    e.stopPropagation();
    this.open.set(!this.open());
    if (this.open()) void this.refresh();
  }

  async readAll() {
    const r = await this.api.markNotificationsRead();
    this.items.set(r.items);
    this.unread.set(r.unread);
  }

  async go(n: AppNotification) {
    this.open.set(false);
    if (!n.readAt) {
      const r = await this.api.markNotificationsRead([n.id]).catch(() => null);
      if (r) { this.items.set(r.items); this.unread.set(r.unread); }
    }
    if (n.link) await this.router.navigateByUrl(n.link);
  }
}
