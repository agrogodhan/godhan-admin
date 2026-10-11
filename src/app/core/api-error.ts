import { HttpErrorResponse } from '@angular/common/http';

// Every backend controller in this platform returns { success, message, data } even on failure
// (core.http.response.error) — this pulls the real message out instead of showing Angular's own
// generic "Http failure response for ..." text.
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    // status 0 = the request never reached a server (service stopped, wrong port, offline, CORS block)
    if (err.status === 0) return 'Cannot reach the server. Check that the service is running and your connection is working.';
    return err.error?.message || err.message || 'Request failed';
  }
  return err instanceof Error ? err.message : 'Request failed';
}
