import { Component, effect, ElementRef, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import { config } from '../core/config';
import type { ChatMessage } from '../core/types';

/** Encrypted consultation chat: history over REST, live delivery over WebSocket. */
@Component({
  selector: 'mc-chat',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="chat">
      <div class="chat-log" #log>
        @for (m of messages(); track m.id) {
          <div class="bubble" [class.me]="m.senderId === me()">
            <span>{{ m.body }}</span><small>{{ m.createdAt | date: 'shortTime' }}</small>
          </div>
        } @empty { <p class="muted center">Messages are private to you and your doctor and stored encrypted.</p> }
      </div>
      @if (error()) {<p class="error">{{ error() }}</p>}
      @if (!readOnly()) {
        <form class="chat-input" (ngSubmit)="send()">
          <input name="text" [(ngModel)]="text" placeholder="Type a message" maxlength="4000" autocomplete="off" aria-label="Message" />
          <button class="btn primary" [disabled]="!text.trim()">Send</button>
        </form>
      }
    </div>
  `,
})
export class Chat implements OnDestroy {
  readonly appointmentId = input.required<string>();
  readonly readOnly = input(false);
  private api = inject(Api);
  private auth = inject(Auth);
  private socket?: Socket;
  private log = viewChild<ElementRef<HTMLDivElement>>('log');
  messages = signal<ChatMessage[]>([]);
  error = signal('');
  text = '';
  me = () => this.auth.user()?.id;

  constructor() {
    effect(() => void this.start(this.appointmentId()));
  }

  private async start(id: string) {
    this.socket?.disconnect();
    try {
      this.messages.set(await this.api.messages(id));
      this.scroll();
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.socket = io(`${config.wsUrl}/chat`, { auth: { token: this.auth.session()?.accessToken }, transports: ['websocket'] });
    this.socket.on('connect', () => this.socket!.emit('join', { appointmentId: id }));
    this.socket.on('message', (m: ChatMessage) => {
      if (!this.messages().some((x) => x.id === m.id)) {
        this.messages.update((list) => [...list, m]);
        this.scroll();
      }
    });
  }

  async send() {
    const body = this.text.trim();
    if (!body) return;
    this.text = '';
    try {
      const m = await this.api.sendMessage(this.appointmentId(), body);
      if (!this.messages().some((x) => x.id === m.id)) this.messages.update((l) => [...l, m]);
      this.scroll();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private scroll() {
    setTimeout(() => {
      const el = this.log()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }
}
