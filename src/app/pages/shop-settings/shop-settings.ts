import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

// Shop-wide settings kept in the shared config store (marketplace-service GET/PUT /shop/settings): the GST
// rates products may use, the delivery fee rule and the seller details printed on GST invoices.
interface ShopSettings {
  gstRates: number[];
  deliveryFlatFee: number;
  freeDeliveryAbove: number;
  seller: { legalName: string; address: string; gstin: string; state: string; invoicePrefix: string };
}

@Component({
  selector: 'app-shop-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './shop-settings.html',
  styleUrl: './shop-settings.scss',
})
export class ShopSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private url = `${API_CONFIG.marketplaceUrl}/shop/settings`;

  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  saved = signal(false);

  // Text/number inputs hold strings while editing; converted on save.
  gstRates = '';
  deliveryFlatFee: number | null = 0;
  freeDeliveryAbove: number | null = 0;
  seller = { legalName: '', address: '', gstin: '', state: '', invoicePrefix: '' };

  ngOnInit(): void {
    this.http.get<{ data: ShopSettings }>(this.url).subscribe({
      next: (res) => { this.apply(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  private apply(s: ShopSettings): void {
    this.gstRates = s.gstRates.join(', ');
    this.deliveryFlatFee = s.deliveryFlatFee;
    this.freeDeliveryAbove = s.freeDeliveryAbove;
    this.seller = { ...s.seller };
  }

  save(): void {
    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    const body = {
      gstRates: this.gstRates,
      deliveryFlatFee: this.deliveryFlatFee ?? 0,
      freeDeliveryAbove: this.freeDeliveryAbove ?? 0,
      seller: this.seller,
    };
    this.http.put<{ data: ShopSettings }>(this.url, body).subscribe({
      next: (res) => { this.apply(res.data); this.saving.set(false); this.saved.set(true); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }
}
