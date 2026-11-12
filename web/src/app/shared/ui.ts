import { Component, input, Pipe, PipeTransform } from '@angular/core';
import { STATUS_LABEL, type AppointmentStatus, type Money } from '../core/types';

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(m: Money | null | undefined): string {
    if (!m) return '';
    if (m.amountMinor === 0) return 'Free';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amountMinor / 100);
  }
}

@Component({
  selector: 'mc-status',
  template: `<span class="status" [attr.data-s]="status()">{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<AppointmentStatus>();
  label = () => STATUS_LABEL[this.status()];
}

@Component({
  selector: 'mc-stars',
  template: `<span class="stars" [attr.aria-label]="value() + ' out of 5'">@for (i of [1,2,3,4,5]; track i) {<span [class.on]="i <= round()">★</span>}</span>`,
})
export class Stars {
  readonly value = input(0);
  round = () => Math.round(this.value());
}

@Component({
  selector: 'mc-avatar',
  template: `@if (src()) {<img [src]="src()" [alt]="name()" />} @else {<span>{{ initials() }}</span>}`,
  host: { class: 'avatar' },
})
export class Avatar {
  readonly name = input('');
  readonly src = input<string | undefined>();
  initials = () => this.name().replace(/^Dr\.\s*/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');
}
