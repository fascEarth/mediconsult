import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { config } from './config';
import type { Role, User } from './types';

interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

const KEY = 'mc.session';
const read = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const write = (s: Session | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* in-memory only */
  }
};

/** Session lives in sessionStorage (cleared when the tab closes): sensible for health data on shared devices. */
@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);
  readonly session = signal<Session | null>(read());
  readonly user = computed(() => this.session()?.user ?? null);
  readonly role = computed(() => this.user()?.role ?? null);
  private refreshing: Promise<boolean> | null = null;

  async login(email: string, password: string) {
    this.set(await firstValueFrom(this.http.post<Session>(`${config.apiUrl}/auth/login`, { email, password })));
  }

  async register(body: Record<string, unknown>, doctor = false) {
    this.set(await firstValueFrom(this.http.post<Session>(`${config.apiUrl}/auth/${doctor ? 'register-doctor' : 'register'}`, body)));
  }

  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const s = this.session();
    if (!s) return Promise.resolve(false);
    this.refreshing = firstValueFrom(this.http.post<Session>(`${config.apiUrl}/auth/refresh`, { refreshToken: s.refreshToken }))
      .then((n) => (this.set(n), true))
      .catch(() => (this.set(null), false))
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout() {
    const s = this.session();
    if (s) await firstValueFrom(this.http.post(`${config.apiUrl}/auth/logout`, { refreshToken: s.refreshToken })).catch(() => undefined);
    this.set(null);
    await this.router.navigateByUrl('/');
  }

  home(): string {
    return this.role() === 'ADMIN' ? '/admin' : '/dashboard';
  }

  private set(s: Session | null) {
    this.session.set(s);
    write(s);
  }
}

const attach = (req: HttpRequest<unknown>, auth: Auth) => {
  const t = auth.session()?.accessToken;
  return t && req.url.startsWith(config.apiUrl) ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req;
};

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const skip = /\/auth\/(login|refresh|register)/.test(req.url);
  return next(attach(req, auth)).pipe(
    catchError((err: HttpErrorResponse) =>
      err.status === 401 && !skip && auth.session()
        ? from(auth.refresh()).pipe(switchMap((ok) => (ok ? next(attach(req, auth)) : throwError(() => err))))
        : throwError(() => err),
    ),
  );
};

export const requireRole = (...roles: Role[]): CanActivateFn => (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const role = auth.role();
  if (!role) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  return roles.length === 0 || roles.includes(role) ? true : router.parseUrl(auth.home());
};

export function errorText(err: unknown): string {
  const e = err as { error?: { message?: string | string[] }; status?: number };
  if (e?.status === 0) return 'Cannot reach the server. Check your connection.';
  const m = e?.error?.message;
  return Array.isArray(m) ? m.join('; ') : m ?? 'Something went wrong. Please try again.';
}
