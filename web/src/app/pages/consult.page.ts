import { Component, effect, ElementRef, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
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
        @if (error()) {
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
  error = signal('');
  isDoctor = () => this.auth.role() === 'DOCTOR';

  constructor() {
    effect(() => void this.start(this.id()));
  }

  private async start(id: string) {
    try {
      const room = await this.api.join(id);
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

  ngOnDestroy() {
    this.jitsi?.dispose();
  }
}
