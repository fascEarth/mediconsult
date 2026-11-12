import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { errorText } from '../core/auth';

interface Block {
  weekday: number;
  startTime: string;
  endTime: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page">
      <h1>Practice settings</h1>
      @if (status()) {<p>Profile status: <span class="tag">{{ status() }}</span></p>}
      @if (msg()) {<p class="ok-text">{{ msg() }}</p>}
      @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
      <div class="two-col">
        <div class="card pad stack">
          <h3>Weekly availability <small class="muted">({{ tz }})</small></h3>
          @for (d of days; track d; let i = $index) {
            <div class="avail-row">
              <b>{{ d }}</b>
              <div class="blocks">
                @for (b of blocksFor(i + 1); track $index) {
                  <span class="block"><input type="time" [(ngModel)]="b.startTime" [name]="'s' + i + $index" aria-label="Start" /> – <input type="time" [(ngModel)]="b.endTime" [name]="'e' + i + $index" aria-label="End" />
                    <button class="link" (click)="removeBlock(b)" aria-label="Remove">✕</button></span>
                }
                <button class="link" (click)="addBlock(i + 1)">+ hours</button>
              </div>
            </div>
          }
          <div class="actions"><button class="btn primary" (click)="saveAvailability()">Save availability</button><button class="btn ghost" (click)="copyWeekdays()">Copy Monday to weekdays</button></div>
        </div>

        <div class="stack">
          <form class="card pad stack" (ngSubmit)="saveProfile()">
            <h3>Profile</h3>
            <label>Consultation fee (₹)<input type="number" min="0" name="fee" [(ngModel)]="fee" /></label>
            <label>Slot length
              <select name="slot" [(ngModel)]="slotMinutes">@for (s of [10, 15, 20, 30, 45, 60]; track s) {<option [ngValue]="s">{{ s }} minutes</option>}</select>
            </label>
            <label>Languages<input name="langs" [(ngModel)]="languages" /></label>
            <label>Bio<textarea rows="4" name="bio" [(ngModel)]="bio"></textarea></label>
            <button class="btn">Save profile</button>
          </form>
          <div class="card pad stack">
            <h3>Time off</h3>
            <div class="grid-2">
              <label>From<input type="datetime-local" name="tf" [(ngModel)]="off.from" /></label>
              <label>To<input type="datetime-local" name="tt" [(ngModel)]="off.to" /></label>
            </div>
            <input name="tr" [(ngModel)]="off.reason" placeholder="Reason (optional)" />
            <button class="btn" (click)="addOff()">Add time off</button>
            @for (t of timeOff(); track t.id) {
              <div class="row-between"><span>{{ t.startsAt | date: 'd MMM, h:mm a' }} → {{ t.endsAt | date: 'd MMM, h:mm a' }}</span><button class="link danger" (click)="removeOff(t.id)">Remove</button></div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export default class DoctorSettingsPage implements OnInit {
  private api = inject(Api);
  days = DAYS;
  tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  blocks: Block[] = [];
  timeOff = signal<{ id: string; startsAt: string; endsAt: string; reason?: string }[]>([]);
  status = signal('');
  msg = signal('');
  error = signal('');
  fee = 0;
  slotMinutes = 15;
  languages = '';
  bio = '';
  off = { from: '', to: '', reason: '' };

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    try {
      const p = await this.api.myDoctorProfile();
      this.status.set(p.status);
      this.blocks = p.availability.map((a) => ({ weekday: a.weekday, startTime: a.startTime, endTime: a.endTime }));
      this.timeOff.set(p.timeOff);
      this.fee = p.fee.amountMinor / 100;
      this.slotMinutes = p.slotMinutes;
      this.languages = p.languages.join(', ');
      this.bio = p.bio ?? '';
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  blocksFor(weekday: number) {
    return this.blocks.filter((b) => b.weekday === weekday);
  }

  addBlock(weekday: number) {
    this.blocks.push({ weekday, startTime: '09:00', endTime: '13:00' });
  }

  removeBlock(b: Block) {
    this.blocks = this.blocks.filter((x) => x !== b);
  }

  copyWeekdays() {
    const mon = this.blocksFor(1);
    this.blocks = [...this.blocks.filter((b) => b.weekday === 1 || b.weekday > 5), ...[2, 3, 4, 5].flatMap((w) => mon.map((b) => ({ ...b, weekday: w })))];
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.msg.set('');
    this.error.set('');
    try {
      await fn();
      this.msg.set(ok);
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  saveAvailability() {
    return this.run(() => this.api.setAvailability(this.blocks), 'Availability saved');
  }

  saveProfile() {
    return this.run(
      () => this.api.updateDoctorProfile({ feeMinor: Math.round(Number(this.fee) * 100), slotMinutes: Number(this.slotMinutes), bio: this.bio || undefined, languages: this.languages.split(',').map((l) => l.trim()).filter(Boolean) }),
      'Profile saved',
    );
  }

  addOff() {
    return this.run(() => this.api.addTimeOff({ startsAt: new Date(this.off.from).toISOString(), endsAt: new Date(this.off.to).toISOString(), reason: this.off.reason || undefined }), 'Time off added');
  }

  removeOff(id: string) {
    return this.run(() => this.api.removeTimeOff(id), 'Removed');
  }
}
