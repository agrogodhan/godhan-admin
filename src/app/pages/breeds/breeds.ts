import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';

// The shared breed list every app screen, the bull catalog and the lineage breed-mix read from
// (cattle-service /breeds). Name and type are fixed once created — cattle and bull records store the
// name — so a different spelling is added as an alias instead.
interface AdminBreed {
  _id: string;
  name: string;
  type: 'cow' | 'buffalo' | 'goat' | 'sheep';
  aliases: string[];
  isPure: boolean;
  sortOrder: number;
  active: boolean;
}

const TYPES = ['cow', 'buffalo', 'goat', 'sheep'] as const;

// "HF, Holstein" <-> ['HF', 'Holstein']
const toAliasList = (text: string): string[] =>
  text.split(',').map((a) => a.trim()).filter((a) => a.length > 0);

@Component({
  selector: 'app-breeds',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './breeds.html',
  styleUrl: './breeds.scss',
})
export class Breeds implements OnInit {
  private http = inject(HttpClient);

  types = TYPES;
  breeds = signal<AdminBreed[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = this.blankForm();

  editingId = signal<string | null>(null);
  editForm = { aliases: '', isPure: true, sortOrder: 100, active: true };
  editSaving = signal(false);
  editError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private blankForm() {
    return { name: '', type: 'cow' as AdminBreed['type'], aliases: '', isPure: true, sortOrder: 100 };
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ data: AdminBreed[] }>(`${API_CONFIG.cattleUrl}/breeds/admin`).subscribe({
      next: (res) => { this.breeds.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  toggleForm(): void {
    this.showForm.set(!this.showForm());
    this.formError.set(null);
    this.form = this.blankForm();
  }

  createBreed(): void {
    this.saving.set(true);
    this.formError.set(null);
    const payload = { ...this.form, aliases: toAliasList(this.form.aliases) };
    this.http.post<{ data: AdminBreed }>(`${API_CONFIG.cattleUrl}/breeds/admin`, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.form = this.blankForm();
        this.load(); // re-read so the new row lands in server sort order (type, then sortOrder)
      },
      error: (err) => { this.formError.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }

  startEdit(b: AdminBreed): void {
    this.editingId.set(b._id);
    this.editError.set(null);
    this.editForm = { aliases: b.aliases.join(', '), isPure: b.isPure, sortOrder: b.sortOrder, active: b.active };
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(b: AdminBreed): void {
    this.editSaving.set(true);
    this.editError.set(null);
    const payload = { ...this.editForm, aliases: toAliasList(this.editForm.aliases) };
    this.http.put<{ data: AdminBreed }>(`${API_CONFIG.cattleUrl}/breeds/admin/${b._id}`, payload).subscribe({
      next: (res) => {
        this.breeds.set(this.breeds().map((x) => (x._id === b._id ? res.data : x)));
        this.editSaving.set(false);
        this.editingId.set(null);
      },
      error: (err) => { this.editError.set(apiErrorMessage(err)); this.editSaving.set(false); },
    });
  }
}
