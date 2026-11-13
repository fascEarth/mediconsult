import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, saveBlob } from '../core/api';
import { Auth, errorText } from '../core/auth';
import type { Appointment, PrescriptionItem } from '../core/types';
import { Chat } from '../shared/chat';
import { MoneyPipe, StatusBadge } from '../shared/ui';
import { environment } from '../../environments/environment';

const emptyItem = (): PrescriptionItem => ({ medicine: '', dosage: '', frequency: '', duration: '', instructions: '' });

@Component({
  imports: [DatePipe, FormsModule, RouterLink, StatusBadge, MoneyPipe, Chat],
  template: `
    @if (a(); as a) {
      <div class="page">
        @if (booked()) {<div class="banner ok">✓ Booked! {{ demo ? 'In the live product a confirmation email is sent.' : 'A confirmation email is on its way.' }}</div>}
        <div class="row-between">
          <div>
            <h1>{{ isDoctor() ? a.patient.name : a.doctor.name }}</h1>
            <p class="muted">{{ a.reference }} · {{ a.startsAt | date: 'EEEE d MMM y, h:mm a' }} – {{ a.endsAt | date: 'h:mm a' }}</p>
          </div>
          <mc-status [status]="a.status" />
        </div>

        <div class="two-col">
          <section class="stack">
            <div class="card pad">
              @if (['CONFIRMED', 'IN_PROGRESS'].includes(a.status)) {
                @if (canJoin()) {
                  <a class="btn primary block lg" [routerLink]="['/consult', a.id]">🎥 Join video consultation</a>
                } @else {
                  <p>The consultation room opens at <b>{{ a.canJoinFrom | date: 'h:mm a, d MMM' }}</b>. Use Chrome, Edge, Safari or Firefox; allow camera and microphone.</p>
                }
              }
              @if (a.status === 'PENDING_PAYMENT') {<a class="btn primary" [routerLink]="['/checkout', a.id]">Complete payment</a>}
              @if (a.reason) {<h3>Reason for visit</h3><p>{{ a.reason }}</p>}
              <p class="muted small">Fee {{ a.fee | money }}</p>
              @if (a.records?.length) {
                <h3>Shared reports</h3>
                @for (r of a.records; track r.id) {<button class="link" (click)="download(r.id, r.title)">📄 {{ r.title }}</button>}
              }
              @if (a.hasPrescription) {<a class="btn" [routerLink]="['/prescription', a.id]">℞ View prescription</a>}
              @if (['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status) && !isAdmin()) {
                <button class="btn ghost danger" (click)="cancel()">Cancel appointment</button>
              }
            </div>

            @if (isDoctor() && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) {
              <div class="card pad">
                <h3>Clinical notes <small class="muted">(private, encrypted)</small></h3>
                <div class="grid-2">
                  <label>Subjective<textarea rows="3" [(ngModel)]="notes.subjective" name="s"></textarea></label>
                  <label>Objective<textarea rows="3" [(ngModel)]="notes.objective" name="o"></textarea></label>
                  <label>Assessment<textarea rows="3" [(ngModel)]="notes.assessment" name="as"></textarea></label>
                  <label>Plan<textarea rows="3" [(ngModel)]="notes.plan" name="p"></textarea></label>
                </div>
                <button class="btn" (click)="saveNotes()">Save notes</button>
              </div>

              <div class="card pad">
                <h3>e-Prescription</h3>
                <label>Diagnosis<input [(ngModel)]="rx.diagnosis" name="dx" /></label>
                <table class="rx-edit">
                  <thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th><th></th></tr></thead>
                  <tbody>
                    @for (it of rx.items; track $index; let i = $index) {
                      <tr>
                        <td><input [(ngModel)]="it.medicine" [name]="'m' + i" aria-label="Medicine" /></td>
                        <td><input [(ngModel)]="it.dosage" [name]="'d' + i" placeholder="500 mg" aria-label="Dose" /></td>
                        <td><input [(ngModel)]="it.frequency" [name]="'f' + i" placeholder="1-0-1" aria-label="Frequency" /></td>
                        <td><input [(ngModel)]="it.duration" [name]="'du' + i" placeholder="5 days" aria-label="Duration" /></td>
                        <td><input [(ngModel)]="it.instructions" [name]="'in' + i" placeholder="After food" aria-label="Instructions" /></td>
                        <td><button class="link" (click)="rx.items.splice(i, 1)" aria-label="Remove">✕</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
                <button class="link" (click)="rx.items.push(emptyItem())">+ Add medicine</button>
                <label>Advice<textarea rows="2" [(ngModel)]="rx.advice" name="adv"></textarea></label>
                <label>Follow up in (days)<input type="number" min="0" [(ngModel)]="rx.followUpDays" name="fu" /></label>
                <div class="actions">
                  <button class="btn primary" (click)="savePrescription()">Issue prescription</button>
                  @if (a.status !== 'COMPLETED') {
                    <button class="btn" (click)="complete()">Mark consultation complete</button>
                    <button class="btn ghost" (click)="noShow()">Patient didn't join</button>
                  }
                </div>
              </div>
            }

            @if (!isDoctor() && a.status === 'COMPLETED' && !a.review) {
              <div class="card pad">
                <h3>How was your consultation?</h3>
                <div class="rate">@for (i of [1,2,3,4,5]; track i) {<button class="star" [class.on]="i <= rating" (click)="rating = i" [attr.aria-label]="i + ' stars'">★</button>}</div>
                <textarea rows="2" [(ngModel)]="reviewText" name="rv" placeholder="Optional comment"></textarea>
                <button class="btn primary" [disabled]="!rating" (click)="sendReview()">Submit review</button>
              </div>
            }
            @if (msg()) {<p class="ok-text">{{ msg() }}</p>}
            @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
          </section>

          @if (!isAdmin() && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) {
            <aside class="card pad"><h3>Messages</h3><mc-chat [appointmentId]="a.id" /></aside>
          }
        </div>
      </div>
    } @else if (error()) {<div class="page"><p class="error">{{ error() }}</p></div>}
  `,
})
export default class AppointmentPage {
  readonly id = input.required<string>();
  readonly bookedParam = input<string>(undefined, { alias: 'booked' });
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  a = signal<Appointment | null>(null);
  error = signal('');
  msg = signal('');
  booked = () => this.bookedParam() === '1';
  demo = environment.demo;
  isDoctor = () => this.auth.role() === 'DOCTOR';
  isAdmin = () => this.auth.role() === 'ADMIN';
  emptyItem = emptyItem;
  notes: { subjective?: string; objective?: string; assessment?: string; plan?: string } = {};
  rx = { diagnosis: '', items: [emptyItem()], advice: '', followUpDays: 0 };
  rating = 0;
  reviewText = '';

  constructor() {
    effect(() => void this.load(this.id()));
  }

  canJoin() {
    const a = this.a();
    return !!a && Date.now() >= new Date(a.canJoinFrom).getTime() && Date.now() <= new Date(a.endsAt).getTime() + 30 * 60_000;
  }

  private async load(id: string) {
    try {
      const a = await this.api.appointment(id);
      this.a.set(a);
      if (this.isDoctor() && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) {
        this.notes = await this.api.notes(id).catch(() => ({}));
        if (a.hasPrescription) {
          const p = await this.api.prescription(id);
          this.rx = { diagnosis: p.diagnosis, items: p.items.length ? p.items : [emptyItem()], advice: p.advice ?? '', followUpDays: p.followUpDays ?? 0 };
        }
      }
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private async act(fn: () => Promise<unknown>, ok: string) {
    this.error.set('');
    this.msg.set('');
    try {
      await fn();
      this.msg.set(ok);
      await this.load(this.id());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  saveNotes() {
    return this.act(() => this.api.saveNotes(this.id(), this.notes), 'Notes saved');
  }

  savePrescription() {
    const items = this.rx.items.filter((i) => i.medicine.trim());
    return this.act(() => this.api.savePrescription(this.id(), { ...this.rx, items, followUpDays: Number(this.rx.followUpDays) || undefined, advice: this.rx.advice || undefined }), 'Prescription issued and shared with the patient');
  }

  complete() {
    return this.act(() => this.api.complete(this.id()), 'Consultation completed');
  }

  noShow() {
    return this.act(() => this.api.noShow(this.id()), 'Marked as no-show');
  }

  cancel() {
    const reason = prompt('Reason for cancelling (optional)') ?? undefined;
    return this.act(() => this.api.cancel(this.id(), reason), 'Appointment cancelled. Any payment will be refunded.');
  }

  sendReview() {
    return this.act(() => this.api.review(this.id(), this.rating, this.reviewText || undefined), 'Thanks for your feedback!');
  }

  async download(id: string, title: string) {
    try {
      saveBlob(await this.api.downloadRecord(id), title);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
