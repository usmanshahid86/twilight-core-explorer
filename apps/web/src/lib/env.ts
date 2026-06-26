// The only network origin the web app is permitted to talk to: the Phase 9 public API.
// Must be NEXT_PUBLIC_ because all fetching is client-side. No chain/RPC/REST/DB access exists.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');
