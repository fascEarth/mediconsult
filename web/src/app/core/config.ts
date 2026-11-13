declare global {
  interface Window {
    __MEDICONSULT__?: { apiUrl?: string; wsUrl?: string };
  }
}
const rt = typeof window !== 'undefined' ? window.__MEDICONSULT__ ?? {} : {};
/** Served from a real domain (behind Caddy): API and sockets live on the same origin. */
const sameOrigin = typeof location !== 'undefined' && !['localhost', '127.0.0.1'].includes(location.hostname);
export const config = {
  apiUrl: rt.apiUrl ?? (sameOrigin ? `${location.origin}/api/v1` : 'http://localhost:3100/api/v1'),
  wsUrl: rt.wsUrl ?? (sameOrigin ? location.origin : 'http://localhost:3100'),
};
