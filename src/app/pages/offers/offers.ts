import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface Offer {
  _id: string;
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  scope: 'dairy_shop' | 'unlock_fee' | 'both';
  category: string | null;
  validUntil: string;
  maxUsesPerFarmer: number;
  maxUsesTotal: number | null;
  usedCount: number;
  isActive: boolean;
}

@Component({
  selector: 'app-offers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './offers.html',
  styleUrl: './offers.scss',
})
export class Offers implements OnInit {
  private http = inject(HttpClient);

  offers = signal<Offer[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = this.blankForm();

  ngOnInit(): void {
    this.load();
  }

  private blankForm() {
    const inAMonth = new Date();
    inAMonth.setDate(inAMonth.getDate() + 30);
    return {
      code: '',
      description: '',
      discountType: 'percent' as 'percent' | 'flat',
      value: 10,
      maxDiscount: null as number | null,
      minOrderValue: 0,
      scope: 'both' as 'dairy_shop' | 'unlock_fee' | 'both',
      category: '',
      validUntil: inAMonth.toISOString().slice(0, 10),
      maxUsesPerFarmer: 1,
      maxUsesTotal: null as number | null,
    };
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ data: Offer[] }>(`${API_CONFIG.marketplaceUrl}/offers`).subscribe({
      next: (res) => { this.offers.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  toggleForm(): void {
    this.showForm.set(!this.showForm());
    this.formError.set(null);
    this.form = this.blankForm();
  }

  createOffer(): void {
    this.saving.set(true);
    this.formError.set(null);
    const payload = {
      ...this.form,
      category: this.form.category || null,
      validUntil: new Date(this.form.validUntil).toISOString(),
    };
    this.http.post<{ data: Offer }>(`${API_CONFIG.marketplaceUrl}/offers`, payload).subscribe({
      next: (res) => {
        this.offers.set([res.data, ...this.offers()]);
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.blankForm();
      },
      error: (err) => { this.formError.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }

  toggleActive(offer: Offer): void {
    this.http.put<{ data: Offer }>(`${API_CONFIG.marketplaceUrl}/offers/${offer._id}`, { isActive: !offer.isActive }).subscribe({
      next: (res) => this.offers.set(this.offers().map((o) => (o._id === offer._id ? res.data : o))),
      error: (err) => this.error.set(apiErrorMessage(err)),
    });
  }
}
