import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface User {
  _id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  role: string;
}
interface UsersResponse {
  data: { users: User[]; page: number; totalPages: number; total: number };
}

const ROLES = ['farmer', 'hub', 'admin'];

@Component({
  selector: 'app-users',
  standalone: true,
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users implements OnInit {
  private http = inject(HttpClient);

  roles = ROLES;
  users = signal<User[]>([]);
  page = signal(1);
  totalPages = signal(1);
  total = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);
  updatingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load(1);
  }

  load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<UsersResponse>(`${API_CONFIG.userUrl}/users`, { params: { page, limit: 20 } }).subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        this.page.set(res.data.page);
        this.totalPages.set(res.data.totalPages);
        this.total.set(res.data.total);
        this.loading.set(false);
      },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  changeRole(user: User, role: string): void {
    if (role === user.role) return;
    this.updatingId.set(user._id);
    this.http.put<{ data: User }>(`${API_CONFIG.userUrl}/users/${user._id}/role`, { role }).subscribe({
      next: (res) => {
        this.users.set(this.users().map((u) => (u._id === user._id ? res.data : u)));
        this.updatingId.set(null);
      },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.updatingId.set(null); },
    });
  }
}
