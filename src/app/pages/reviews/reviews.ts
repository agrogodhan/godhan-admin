import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface PendingReview {
  _id: string;
  productId: string;
  productName: string;
  userName: string;
  rating: number;
  comment: string;
  date: string;
}

@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reviews.html',
  styleUrl: './reviews.scss',
})
export class Reviews implements OnInit {
  private http = inject(HttpClient);

  reviews = signal<PendingReview[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  moderatingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ data: PendingReview[] }>(`${API_CONFIG.marketplaceUrl}/product/reviews/pending`).subscribe({
      next: (res) => { this.reviews.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  // Green/amber/red rating bands — same convention as the order-status badges elsewhere in this
  // app, informed by how Flipkart color-codes its own rating badges on product listings.
  ratingBand(rating: number): 'high' | 'mid' | 'low' {
    if (rating >= 4) return 'high';
    if (rating === 3) return 'mid';
    return 'low';
  }

  moderate(review: PendingReview, status: 'approved' | 'rejected'): void {
    this.moderatingId.set(review._id);
    this.http
      .put(`${API_CONFIG.marketplaceUrl}/product/${review.productId}/reviews/${review._id}/moderate`, { status })
      .subscribe({
        next: () => {
          this.reviews.set(this.reviews().filter((r) => r._id !== review._id));
          this.moderatingId.set(null);
        },
        error: (err) => { this.error.set(apiErrorMessage(err)); this.moderatingId.set(null); },
      });
  }
}
