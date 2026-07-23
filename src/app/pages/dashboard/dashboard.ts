import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../core/api-config';

interface Paged<T> {
  data: { items: T[]; total: number };
}
interface UsersPaged {
  data: { users: unknown[]; total: number };
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private http = inject(HttpClient);

  userCount = signal<number | null>(null);
  orderCount = signal<number | null>(null);
  loadError = signal<string | null>(null);

  ngOnInit(): void {
    // Best-effort — a dashboard summary tile failing to load shouldn't block the rest of the
    // portal; each count is independent so one endpoint being down doesn't blank both.
    this.http.get<UsersPaged>(`${API_CONFIG.userUrl}/users?limit=1`).subscribe({
      next: (res) => this.userCount.set(res.data.total),
      error: () => this.loadError.set('Could not load user count — is user-service running?'),
    });
    this.http.get<Paged<unknown>>(`${API_CONFIG.marketplaceUrl}/order/all?limit=1`).subscribe({
      next: (res) => this.orderCount.set(res.data.total),
      error: () => this.loadError.set('Could not load order count — is marketplace-service running?'),
    });
  }
}
