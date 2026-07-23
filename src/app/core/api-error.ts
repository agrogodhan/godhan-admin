import { HttpErrorResponse } from '@angular/common/http';

// Every backend controller in this platform returns { success, message, data } even on failure
// (core.http.response.error) — this pulls the real message out instead of showing Angular's own
// generic "Http failure response for ..." text.
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    return err.error?.message || err.message || 'Request failed';
  }
  return err instanceof Error ? err.message : 'Request failed';
}
