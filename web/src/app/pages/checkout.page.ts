import { Component, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import type { Appointment } from '../core/types';
import { MoneyPipe } from '../shared/ui';

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

@Component({
  imports: [DatePipe, MoneyPipe],
  template: `
    <div class="page narrow">
      @if (appt(); as a) {
        <div class="card pad">
          <h1>Confirm and pay</h1>
          <dl class="summary">
            <dt>Doctor</dt><dd>{{ a.doctor.name }} · {{ a.doctor.specialty }}</dd>
            <dt>When</dt><dd>{{ a.startsAt | date: 'EEEE d MMMM y, h:mm a' }}</dd>
            <dt>Reference</dt><dd>{{ a.reference }}</dd>
            <dt>Fee</dt><dd><b>{{ a.fee | money }}</b></dd>
          </dl>
          @if (remaining() > 0) {
            <p class="muted">Your slot is held for <b>{{ mm() }}:{{ ss() }}</b></p>
            @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
            <button class="btn primary block" (click)="pay()" [disabled]="busy()">{{ busy() ? 'Processing…' : 'Pay ' + (a.fee | money) }}</button>
            @if (api.publicConfig()?.paymentProvider === 'demo') {<p class="muted small center">Demo mode: no real payment is taken.</p>}
            <p class="muted small center">Free cancellation up to 2 hours before the consultation.</p>
          } @else {
            <p class="error">This hold expired. Please choose the slot again.</p>
            <button class="btn" (click)="back()">Choose another time</button>
          }
        </div>
      } @else if (error()) {<p class="error">{{ error() }}</p>}
    </div>
  `,
})
export default class CheckoutPage implements OnDestroy {
  readonly id = input.required<string>();
  api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  appt = signal<Appointment | null>(null);
  remaining = signal(0);
  busy = signal(false);
  error = signal('');
  private timer?: ReturnType<typeof setInterval>;

  mm = () => String(Math.floor(this.remaining() / 60)).padStart(2, '0');
  ss = () => String(this.remaining() % 60).padStart(2, '0');

  constructor() {
    effect(() => void this.load(this.id()));
  }

  private async load(id: string) {
    try {
      const a = await this.api.appointment(id);
      if (a.status !== 'PENDING_PAYMENT') {
        await this.router.navigate(['/appointments', id]);
        return;
      }
      this.appt.set(a);
      clearInterval(this.timer);
      const tick = () => this.remaining.set(Math.max(0, Math.floor((new Date(a.holdExpiresAt!).getTime() - Date.now()) / 1000)));
      tick();
      this.timer = setInterval(tick, 1000);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async pay() {
    this.busy.set(true);
    this.error.set('');
    try {
      const order = await this.api.createPayment(this.id());
      if (order.provider === 'demo') {
        await this.api.confirmPayment(this.id(), { orderId: order.orderId, paymentId: `demo_pay_${crypto.randomUUID().replace(/-/g, '')}` });
        await this.router.navigate(['/appointments', this.id()], { queryParams: { booked: 1 } });
        return;
      }
      await this.razorpay(order);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async razorpay(order: { orderId: string; amountMinor: number; currency: string; clientData: Record<string, unknown> }) {
    if (!window.Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load payment window'));
        document.body.appendChild(s);
      });
    }
    const user = this.auth.user();
    new window.Razorpay!({
      key: order.clientData['keyId'], amount: order.amountMinor, currency: order.currency, order_id: order.orderId,
      name: 'MediConsult', description: `Consultation ${this.appt()?.reference}`,
      prefill: { name: `${user?.firstName} ${user?.lastName}`, email: user?.email, contact: user?.phone },
      handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          await this.api.confirmPayment(this.id(), { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
          await this.router.navigate(['/appointments', this.id()], { queryParams: { booked: 1 } });
        } catch (e) {
          this.error.set(errorText(e));
        }
      },
    }).open();
  }

  back() {
    void this.router.navigate(['/doctors', this.appt()?.doctor.id]);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }
}
