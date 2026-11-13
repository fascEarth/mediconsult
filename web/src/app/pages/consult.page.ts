import { Component, effect, ElementRef, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { Api } from '../core/api';
import { Auth, errorText } from '../core/auth';
import { Chat } from '../shared/chat';

interface JitsiApi {
  dispose(): void;
  addListener(event: string, fn: () => void): void;
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => JitsiApi;
  }
}

/** Video room (Jitsi, embedded) + chat side panel. Room id is issued by the API only inside the join window. */
@Component({
  imports: [RouterLink, Chat],
  template: `
    <div class="consult">
      <div class="video" #video>
        @if (demoRoom(); as room) {
          <div class="demo-room">
            <div class="tile remote">
              <div class="ring"><span>{{ initials(room.peerName) }}</span></div>
              <b>{{ room.peerName }}</b>
              <small>Demo participant · open another tab as {{ isDoctor() ? 'the patient' : 'the doctor' }} to chat live</small>
            </div>
            <div class="tile local">
              <video #cam autoplay playsinline muted [hidden]="!camOn()"></video>
              @if (!camOn()) {<span class="you">{{ initials(room.displayName) }}</span>}
              <small class="label">You · {{ room.displayName }}</small>
            </div>
            <div class="controls">
              <button class="ctl" [class.off]="muted()" (click)="muted.set(!muted())" [attr.aria-label]="muted() ? 'Unmute' : 'Mute'">{{ muted() ? '🔇' : '🎙️' }}</button>
              <button class="ctl" [class.off]="!camOn()" (click)="toggleCam()" [attr.aria-label]="camOn() ? 'Camera off' : 'Camera on'">{{ camOn() ? '📷' : '📷̸' }}</button>
              <button class="ctl end" (click)="leave()" aria-label="Leave call">✕</button>
            </div>
            <p class="demo-note">Demo room. In production this is an encrypted Jitsi video call that opens only for the patient and doctor.</p>
          </div>
        } @else if (error()) {
          <div class="video-msg"><p class="error">{{ error() }}</p><a class="btn" [routerLink]="['/appointments', id()]">Back to appointment</a></div>
        } @else if (!ready()) {
          <div class="video-msg"><p>Connecting securely…</p></div>
        }
      </div>
      <aside class="consult-side">
        <div class="row-between"><b>Chat</b><a class="btn ghost sm" [routerLink]="['/appointments', id()]">{{ isDoctor() ? 'Notes & prescription' : 'Details' }}</a></div>
        <mc-chat [appointmentId]="id()" />
      </aside>
    </div>
  `,
})
export default class ConsultPage implements OnDestroy {
  readonly id = input.required<string>();
  private api = inject(Api);
  private auth = inject(Auth);
  private host = viewChild.required<ElementRef<HTMLDivElement>>('video');
  private jitsi?: JitsiApi;
  ready = signal(false);
  demoRoom = signal<{ displayName: string; peerName: string } | null>(null);
  muted = signal(false);
  camOn = signal(false);
  private stream?: MediaStream;
  private router = inject(Router);
  private cam = viewChild<ElementRef<HTMLVideoElement>>('cam');
  initials = (n: string) => n.replace(/^Dr\.\s*/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');
  error = signal('');
  isDoctor = () => this.auth.role() === 'DOCTOR';

  constructor() {
    effect(() => void this.start(this.id()));
  }

  private async start(id: string) {
    try {
      const room = await this.api.join(id);
      if (environment.demo) {
        this.demoRoom.set({ displayName: room.displayName, peerName: (room as unknown as { peerName: string }).peerName });
        return;
      }
      await this.loadScript(room.domain);
      this.jitsi?.dispose();
      this.jitsi = new window.JitsiMeetExternalAPI!(room.domain, {
        roomName: room.roomName,
        parentNode: this.host().nativeElement,
        width: '100%',
        height: '100%',
        userInfo: { displayName: room.displayName, email: this.auth.user()?.email },
        configOverwrite: {
          subject: room.subject,
          prejoinPageEnabled: true,
          disableDeepLinking: true,
          enableLobbyChat: false,
          disableInviteFunctions: true,
          startWithAudioMuted: false,
          fileRecordingsEnabled: false,
          liveStreamingEnabled: false,
        },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, TOOLBAR_BUTTONS: ['microphone', 'camera', 'desktop', 'fullscreen', 'hangup', 'settings', 'tileview', 'videoquality'] },
      });
      this.jitsi.addListener('videoConferenceJoined', () => this.ready.set(true));
      this.ready.set(true);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private loadScript(domain: string) {
    if (window.JitsiMeetExternalAPI) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://${domain}/external_api.js`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the video service'));
      document.body.appendChild(s);
    });
  }

  async toggleCam() {
    if (this.camOn()) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.camOn.set(false);
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.camOn.set(true);
      setTimeout(() => {
        const v = this.cam()?.nativeElement;
        if (v) v.srcObject = this.stream!;
      });
    } catch {
      this.error.set('Camera not available or permission denied.');
    }
  }

  leave() {
    void this.router.navigate(['/appointments', this.id()]);
  }

  ngOnDestroy() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.jitsi?.dispose();
  }
}
