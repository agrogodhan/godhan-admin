import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface Product {
  _id: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  price: number;
  mrp: number;
  unit: string;
  stock: number;
  isVerified: boolean;
  images: string[];
}

const CATEGORIES = ['feed', 'medicine', 'equipment', 'supplement'];

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products implements OnInit {
  private http = inject(HttpClient);

  categories = CATEGORIES;
  products = signal<Product[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = this.blankForm();

  // Which product's stock field is being edited inline, and the pending delta typed so far.
  stockEditId = signal<string | null>(null);
  stockDelta = 0;

  // Which product currently has an image upload in flight — disables that row's controls only,
  // not the whole page, since uploads are per-product and independent of each other.
  uploadingId = signal<string | null>(null);
  imageError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private blankForm() {
    return { name: '', category: 'feed', brand: '', description: '', price: 0, mrp: 0, unit: 'kg', stock: 0 };
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ data: Product[] }>(`${API_CONFIG.marketplaceUrl}/product`).subscribe({
      next: (res) => { this.products.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  toggleForm(): void {
    this.showForm.set(!this.showForm());
    this.formError.set(null);
    this.form = this.blankForm();
  }

  createProduct(): void {
    this.saving.set(true);
    this.formError.set(null);
    this.http.post<{ data: Product }>(`${API_CONFIG.marketplaceUrl}/product`, this.form).subscribe({
      next: (res) => {
        this.products.set([res.data, ...this.products()]);
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.blankForm();
      },
      error: (err) => { this.formError.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }

  startStockEdit(product: Product): void {
    this.stockEditId.set(product._id);
    this.stockDelta = 0;
  }

  cancelStockEdit(): void {
    this.stockEditId.set(null);
  }

  applyStockChange(product: Product): void {
    if (!this.stockDelta) { this.stockEditId.set(null); return; }
    this.http.post<{ data: Product }>(`${API_CONFIG.marketplaceUrl}/product/${product._id}/stock`, { qtyChange: this.stockDelta })
      .subscribe({
        next: (res) => {
          this.products.set(this.products().map((p) => (p._id === product._id ? res.data : p)));
          this.stockEditId.set(null);
        },
        error: (err) => { this.error.set(apiErrorMessage(err)); this.stockEditId.set(null); },
      });
  }

  // Bound to a hidden per-row <input type="file">, triggered by a visible "Upload" button —
  // same indirection every plain HTML file input needs for custom styling.
  onImageFileSelected(product: Product, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same filename later
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.imageError.set('Only JPEG, PNG or WebP images are supported.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.imageError.set('Image must be under 5 MB.');
      return;
    }

    this.imageError.set(null);
    this.uploadingId.set(product._id);
    const formData = new FormData();
    formData.append('image', file);
    this.http.post<{ data: Product }>(`${API_CONFIG.marketplaceUrl}/product/${product._id}/images`, formData).subscribe({
      next: (res) => {
        this.products.set(this.products().map((p) => (p._id === product._id ? res.data : p)));
        this.uploadingId.set(null);
      },
      error: (err) => { this.imageError.set(apiErrorMessage(err)); this.uploadingId.set(null); },
    });
  }

  removeImage(product: Product, imageUrl: string): void {
    this.http.request<{ data: Product }>('DELETE', `${API_CONFIG.marketplaceUrl}/product/${product._id}/images`, { body: { imageUrl } })
      .subscribe({
        next: (res) => {
          this.products.set(this.products().map((p) => (p._id === product._id ? res.data : p)));
        },
        error: (err) => { this.imageError.set(apiErrorMessage(err)); },
      });
  }
}
