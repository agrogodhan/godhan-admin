import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

interface CatalogBull {
  _id: string;
  breed: string;
  type: 'cow' | 'buffalo';
  brand: string;
  name: string;
  tag: string; // NDLM Bull ID / AI-center straw-tag number
  semenType: 'sexed' | 'conventional' | null;
  registrationNumber: string;
  notes: string;
}

const TYPES: Array<'cow' | 'buffalo'> = ['cow', 'buffalo'];
const SEMEN_TYPES = ['sexed', 'conventional'] as const;

@Component({
  selector: 'app-bulls',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './bulls.html',
  styleUrl: './bulls.scss',
})
export class Bulls implements OnInit {
  private http = inject(HttpClient);

  types = TYPES;
  semenTypes = SEMEN_TYPES;
  bulls = signal<CatalogBull[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = this.blankForm();

  editingId = signal<string | null>(null);
  editForm = this.blankForm();
  editSaving = signal(false);
  editError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private blankForm() {
    return { breed: '', type: 'cow' as 'cow' | 'buffalo', brand: '', name: '', tag: '', semenType: '' as '' | 'sexed' | 'conventional', registrationNumber: '', notes: '' };
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ data: CatalogBull[] }>(`${API_CONFIG.cattleUrl}/bulls/admin`).subscribe({
      next: (res) => { this.bulls.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  toggleForm(): void {
    this.showForm.set(!this.showForm());
    this.formError.set(null);
    this.form = this.blankForm();
  }

  createBull(): void {
    this.saving.set(true);
    this.formError.set(null);
    const payload = { ...this.form, semenType: this.form.semenType || null };
    this.http.post<{ data: CatalogBull }>(`${API_CONFIG.cattleUrl}/bulls/admin`, payload).subscribe({
      next: (res) => {
        this.bulls.set([res.data, ...this.bulls()]);
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.blankForm();
      },
      error: (err) => { this.formError.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }

  startEdit(bull: CatalogBull): void {
    this.editingId.set(bull._id);
    this.editError.set(null);
    this.editForm = {
      breed: bull.breed,
      type: bull.type,
      brand: bull.brand,
      name: bull.name,
      tag: bull.tag,
      semenType: bull.semenType ?? '',
      registrationNumber: bull.registrationNumber,
      notes: bull.notes,
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(bull: CatalogBull): void {
    this.editSaving.set(true);
    this.editError.set(null);
    const payload = { ...this.editForm, semenType: this.editForm.semenType || null };
    this.http.put<{ data: CatalogBull }>(`${API_CONFIG.cattleUrl}/bulls/admin/${bull._id}`, payload).subscribe({
      next: (res) => {
        this.bulls.set(this.bulls().map((b) => (b._id === bull._id ? res.data : b)));
        this.editSaving.set(false);
        this.editingId.set(null);
      },
      error: (err) => { this.editError.set(apiErrorMessage(err)); this.editSaving.set(false); },
    });
  }
}
