import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// Signed in as an admin or a vet.
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isAdmin || auth.isVet) return true;
  inject(Router).navigate(['/login']);
  return false;
};

// Every screen except Knowledge is admin-only; a vet who types such an address is sent to their own screen.
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isAdmin) return true;
  inject(Router).navigate([auth.isVet ? '/knowledge' : '/login']);
  return false;
};
