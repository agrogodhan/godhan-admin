import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface OrderItem {
  name: string;
  quantity: number;
  subtotal: number;
}
interface Order {
  _id: string;
  farmerId: string;
  items: OrderItem[];
  totalAmount: number;
  discountAmount: number;
  status: string;
  createdAt: string;
}
interface OrdersResponse {
  data: { items: Order[]; page: number; hasMore: boolean; total: number };
}

const NEXT_STATUS: Record<string, string[]> = {
  paid: ['delivered', 'cancelled'],
  pending: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class Orders implements OnInit {
  private http = inject(HttpClient);

  orders = signal<Order[]>([]);
  total = signal(0);
  page = signal(1);
  hasMore = signal(false);
  loading = signal(true);
  error = signal<string | null>(null);
  updatingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load(1);
  }

  load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<OrdersResponse>(`${API_CONFIG.marketplaceUrl}/order/all`, { params: { page, limit: 20 } }).subscribe({
      next: (res) => {
        this.orders.set(page === 1 ? res.data.items : [...this.orders(), ...res.data.items]);
        this.page.set(res.data.page);
        this.hasMore.set(res.data.hasMore);
        this.total.set(res.data.total);
        this.loading.set(false);
      },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  loadMore(): void {
    this.load(this.page() + 1);
  }

  nextStatuses(status: string): string[] {
    return NEXT_STATUS[status] ?? [];
  }

  updateStatus(order: Order, status: string): void {
    this.updatingId.set(order._id);
    this.http.put<{ data: Order }>(`${API_CONFIG.marketplaceUrl}/order/${order._id}/status`, { status }).subscribe({
      next: (res) => {
        this.orders.set(this.orders().map((o) => (o._id === order._id ? res.data : o)));
        this.updatingId.set(null);
      },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.updatingId.set(null); },
    });
  }
}
