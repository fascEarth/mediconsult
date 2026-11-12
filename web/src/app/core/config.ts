declare global {
  interface Window {
    __MEDICONSULT__?: { apiUrl?: string; wsUrl?: string };
  }
}
const rt = typeof window !== 'undefined' ? window.__MEDICONSULT__ ?? {} : {};
export const config = {
  apiUrl: rt.apiUrl ?? 'http://localhost:3100/api/v1',
  wsUrl: rt.wsUrl ?? 'http://localhost:3100',
};
