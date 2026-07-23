import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from './api-config';

interface TokenPayload {
  id: string;
  name?: string;
  email?: string | null;
  role?: string;
}

interface LoginResponse {
  data: {
    token: string;
    refreshToken: string;
    user: { id: string; name: string; email: string | null };
  };
}

const STORAGE_KEY = 'godhan_admin_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Signal, not a BehaviorSubject — every admin page here is a simple CRUD screen, no need for
  // the extra RxJS machinery when a signal reads just as easily in templates and effects.
  readonly token = signal<string | null>(localStorage.getItem(STORAGE_KEY));
  readonly currentUser = signal<TokenPayload | null>(this.decode(localStorage.getItem(STORAGE_KEY)));

  constructor(private http: HttpClient, private router: Router) {}

  get isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }

  private decode(token: string | null): TokenPayload | null {
    if (!token) return null;
    try {
      const payloadB64 = token.split('.')[1];
      // JWT uses base64url, not plain base64 — swap the two characters that differ before
      // decoding, otherwise atob() throws on real tokens that contain either of them.
      const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(normalized));
    } catch {
      return null;
    }
  }

  // Throws a clear error (surfaced by the login page) rather than silently logging in a
  // non-admin — this portal has nothing to offer a real farmer account, and letting one land on
  // an empty/erroring dashboard would be a confusing dead end.
  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${API_CONFIG.userUrl}/auth/login/email`, { email, password }),
    );
    const token = res.data.token;
    const payload = this.decode(token);
    if (payload?.role !== 'admin') {
      throw new Error('This account is not an admin. Ask an existing admin to promote it first.');
    }
    localStorage.setItem(STORAGE_KEY, token);
    this.token.set(token);
    this.currentUser.set(payload);
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}
