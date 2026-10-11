import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { parseCsv } from '../../core/csv';

// Dairy Shop catalog admin (spec: docs/redesign/DAIRY_SHOP_LISTING_SPEC.md, phase 1). The list is filtered and
// paged by the server; a product opens in a popup that is read-only until an admin switches it to edit mode.

interface QualityCheck { key: string; label: string; ok: boolean }
interface Row { ingredient?: string; amount?: string; animal?: string; ageGroup?: string; frequency?: string; label?: string; value?: string; question?: string; answer?: string }

interface AdminProduct {
  _id: string;
  name: string;
  slug?: string;
  category: string;
  subcategory?: string;
  brand: string;
  tags?: string[];
  status: 'draft' | 'active' | 'archived';
  isVerified: boolean;
  price: number;
  mrp: number;
  unit: string;
  stock: number;
  offerPrice?: number | null;
  offerEndsAt?: string | null;
  images: string[];
  imageAlts?: string[];
  videoUrl?: string;
  shortDescription?: string;
  highlights?: string[];
  description: string;
  composition?: Array<{ ingredient: string; amount: string }>;
  dosage?: Array<{ animal: string; ageGroup: string; amount: string; frequency: string }>;
  howToUse?: string;
  suitableFor?: string[];
  form?: string;
  storage?: string;
  shelfLifeMonths?: number | null;
  manufacturer?: string;
  countryOfOrigin?: string;
  licenceNo?: string;
  certifications?: string[];
  warnings?: string;
  withdrawalPeriodDays?: number | null;
  specifications?: Array<{ label: string; value: string }>;
  faqs?: Array<{ question: string; answer: string }>;
  returnable?: boolean;
  codAvailable?: boolean;
  cancellableUntilShipped?: boolean;
  deliveryEstimateDays?: number | null;
  gstRate?: number | null;
  hsnCode?: string;
  freeDelivery?: boolean;
  contentSource?: { kind?: string; name?: string; url?: string };
  contentReview?: { reviewedBy?: string; reviewedAt?: string | null; note?: string };
  quality?: { score: number; checks: QualityCheck[] };
  needsVetReview?: boolean;
  isReviewed?: boolean;
  ratings?: { average: number; count: number };
}

interface CategoryDef { key: string; label: string; subcategories: Array<{ key: string; label: string }>; specTemplate: string[] }
interface ImportSummary { total: number; toAdd: number; toUpdate: number; forcedDraft: number; errors: Array<{ line: number; name: string; message: string }>; added?: number; updated?: number }

type Tab = 'identity' | 'pricing' | 'content' | 'specs' | 'media' | 'policy' | 'review';

const SUITABLE = ['cow', 'buffalo', 'calf', 'heifer', 'goat', 'sheep'];
const FORMS = ['powder', 'liquid', 'pellet', 'granules', 'bolus', 'block', 'gel', 'equipment', 'other'];
const STATUSES = ['draft', 'active', 'archived'];
const MAX_IMAGES = 8;
const BATCH = 300;
const IMPORT_COLUMNS = ('name,brand,category,subcategory,price,mrp,unit,stock,status,shortDescription,highlights,description,tags,suitableFor,form,' +
  'composition,dosage,howToUse,storage,shelfLifeMonths,manufacturer,countryOfOrigin,licenceNo,certifications,warnings,withdrawalPeriodDays,' +
  'specifications,gstRate,hsnCode,imageUrls,videoUrl,isVerified,contentSourceKind,contentSourceName,contentSourceUrl').split(',');

// What the edit form binds to. Numbers are kept as strings/null while typing; the payload converts them.
interface Form {
  name: string; category: string; subcategory: string; brand: string; tags: string; status: string; isVerified: boolean;
  unit: string; price: number | null; mrp: number | null; stock: number | null; offerPrice: number | null; offerEndsAt: string;
  gstRate: number | null; hsnCode: string;
  shortDescription: string; highlights: string; description: string; howToUse: string; warnings: string;
  suitableFor: string[]; form: string; storage: string; shelfLifeMonths: number | null; manufacturer: string; countryOfOrigin: string;
  licenceNo: string; certifications: string; withdrawalPeriodDays: number | null; videoUrl: string;
  composition: Row[]; dosage: Row[]; specifications: Row[]; faqs: Row[];
  codAvailable: boolean; cancellableUntilShipped: boolean; deliveryEstimateDays: number | null; freeDelivery: boolean;
  contentSource: { kind: string; name: string; url: string };
}

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private url = API_CONFIG.marketplaceUrl;

  suitableOptions = SUITABLE;
  formOptions = FORMS;
  statusOptions = STATUSES;
  maxImages = MAX_IMAGES;

  // ── server-driven list ──
  items = signal<AdminProduct[]>([]);
  total = signal(0);
  page = signal(1);
  pages = signal(1);
  pageSize = signal(25);
  pageSizes = [10, 25, 50, 100];
  brands = signal<string[]>([]);
  categories = signal<CategoryDef[]>([]);
  gstRates = signal<number[]>([0, 5, 12, 18]);
  loading = signal(true);
  error = signal<string | null>(null);

  search = signal('');
  fCategory = signal('');
  fSub = signal('');
  fBrand = signal('');
  fStatus = signal('');
  fLow = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  subOptions = computed(() => this.categories().find((c) => c.key === this.fCategory())?.subcategories ?? []);
  rangeLabel = computed(() => {
    const n = this.total();
    if (n === 0) return '0 products';
    const start = (this.page() - 1) * this.pageSize();
    return `${start + 1}–${Math.min(start + this.pageSize(), n)} of ${n}`;
  });
  get filtersActive(): boolean {
    return !!(this.search() || this.fCategory() || this.fSub() || this.fBrand() || this.fStatus() || this.fLow());
  }
  get canEdit(): boolean { return this.auth.isAdmin; }

  ngOnInit(): void {
    this.loadLookups();
    this.load();
  }

  // Category tree and GST rates feed the filters and the edit form; a failure is shown once through the page banner
  // (load() shows its own), not left as an unhandled error in the console.
  private loadLookups(): void {
    this.http.get<{ data: CategoryDef[] }>(`${this.url}/product/categories`).subscribe({
      next: (r) => this.categories.set(r.data),
      error: (err) => { if (!this.error()) this.error.set(apiErrorMessage(err)); },
    });
    this.http.get<{ data: { gstRates: number[] } }>(`${this.url}/shop/config`).subscribe({
      next: (r) => this.gstRates.set(r.data.gstRates),
      error: () => { /* keeps the default GST rate list; the Pricing tab still works */ },
    });
  }

  retry(): void {
    this.error.set(null);
    if (this.categories().length === 0) this.loadLookups();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    let params = new HttpParams().set('page', this.page()).set('limit', this.pageSize());
    const add = (k: string, v: string) => { if (v) params = params.set(k, v); };
    add('q', this.search().trim()); add('category', this.fCategory()); add('subcategory', this.fSub());
    add('brand', this.fBrand()); add('status', this.fStatus()); add('lowStock', this.fLow());
    this.http.get<{ data: { items: AdminProduct[]; total: number; page: number; pages: number; brands: string[] } }>(`${this.url}/product/admin`, { params }).subscribe({
      next: (res) => {
        const d = res.data;
        this.items.set(d.items); this.total.set(d.total); this.pages.set(d.pages); this.brands.set(d.brands);
        if (d.page !== this.page()) this.page.set(d.page);
        this.loading.set(false);
      },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  // ── filters ──
  onSearch(v: string): void {
    this.search.set(v);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 300);
  }
  setFilter(sig: { set(v: string): void }, v: string): void {
    sig.set(v);
    this.page.set(1);
    this.load();
  }
  setCategoryFilter(v: string): void {
    this.fCategory.set(v);
    this.fSub.set('');
    this.page.set(1);
    this.load();
  }
  clearFilters(): void {
    this.search.set(''); this.fCategory.set(''); this.fSub.set(''); this.fBrand.set(''); this.fStatus.set(''); this.fLow.set('');
    this.page.set(1);
    this.load();
  }
  goPage(n: number): void {
    this.page.set(Math.min(Math.max(1, n), this.pages()));
    this.load();
  }
  setPageSize(n: number): void {
    this.pageSize.set(Number(n));
    this.page.set(1);
    this.load();
  }
  categoryLabel(key: string): string { return this.categories().find((c) => c.key === key)?.label ?? key; }
  subLabel(cat: string, sub?: string): string { return this.categories().find((c) => c.key === cat)?.subcategories.find((s) => s.key === sub)?.label ?? ''; }
  discount(p: AdminProduct): number { return p.mrp > 0 && p.price < p.mrp ? Math.round((1 - p.price / p.mrp) * 100) : 0; }

  // ── popup: view / edit / create ──
  detail = signal<AdminProduct | null>(null);
  editing = signal(false);
  creating = signal(false);
  tab = signal<Tab>('identity');
  saving = signal(false);
  formError = signal<string | null>(null);
  form: Form = this.blankForm();

  tabs: Array<[Tab, string]> = [
    ['identity', 'Identity'], ['pricing', 'Pricing & tax'], ['content', 'Content'], ['specs', 'Specifications'],
    ['media', 'Media'], ['policy', 'Delivery & policy'], ['review', 'Veterinary review'],
  ];

  blankForm(): Form {
    return {
      name: '', category: 'feed', subcategory: '', brand: '', tags: '', status: 'draft', isVerified: false,
      unit: 'kg', price: null, mrp: null, stock: 0, offerPrice: null, offerEndsAt: '', gstRate: null, hsnCode: '',
      shortDescription: '', highlights: '', description: '', howToUse: '', warnings: '',
      suitableFor: [], form: '', storage: '', shelfLifeMonths: null, manufacturer: '', countryOfOrigin: '',
      licenceNo: '', certifications: '', withdrawalPeriodDays: null, videoUrl: '',
      composition: [], dosage: [], specifications: [], faqs: [],
      codAvailable: true, cancellableUntilShipped: true, deliveryEstimateDays: null, freeDelivery: false,
      contentSource: { kind: '', name: '', url: '' },
    };
  }

  private toForm(p: AdminProduct): Form {
    const rows = <T>(v: T[] | undefined) => (v ?? []).map((r) => ({ ...r }));
    return {
      name: p.name, category: p.category, subcategory: p.subcategory ?? '', brand: p.brand ?? '', tags: (p.tags ?? []).join(', '),
      status: p.status ?? 'active', isVerified: !!p.isVerified, unit: p.unit ?? 'kg', price: p.price, mrp: p.mrp, stock: p.stock,
      offerPrice: p.offerPrice ?? null, offerEndsAt: p.offerEndsAt ? p.offerEndsAt.slice(0, 10) : '', gstRate: p.gstRate ?? null, hsnCode: p.hsnCode ?? '',
      shortDescription: p.shortDescription ?? '', highlights: (p.highlights ?? []).join('\n'), description: p.description ?? '',
      howToUse: p.howToUse ?? '', warnings: p.warnings ?? '', suitableFor: [...(p.suitableFor ?? [])], form: p.form ?? '', storage: p.storage ?? '',
      shelfLifeMonths: p.shelfLifeMonths ?? null, manufacturer: p.manufacturer ?? '', countryOfOrigin: p.countryOfOrigin ?? '',
      licenceNo: p.licenceNo ?? '', certifications: (p.certifications ?? []).join(', '), withdrawalPeriodDays: p.withdrawalPeriodDays ?? null,
      videoUrl: p.videoUrl ?? '', composition: rows<Row>(p.composition), dosage: rows<Row>(p.dosage), specifications: rows<Row>(p.specifications), faqs: rows<Row>(p.faqs),
      codAvailable: p.codAvailable !== false, cancellableUntilShipped: p.cancellableUntilShipped !== false,
      deliveryEstimateDays: p.deliveryEstimateDays ?? null, freeDelivery: !!p.freeDelivery,
      contentSource: { kind: p.contentSource?.kind ?? '', name: p.contentSource?.name ?? '', url: p.contentSource?.url ?? '' },
    };
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    const p = this.detail();
    if (t === 'media' && p) this.syncAlts(p);
  }
  openDetail(p: AdminProduct): void {
    this.detail.set(p);
    this.syncAlts(p);
    this.editing.set(false);
    this.creating.set(false);
    this.tab.set('identity');
    this.formError.set(null);
    this.mediaMsg.set(null);
  }
  openCreate(): void {
    if (!this.canEdit) return;
    this.form = this.blankForm();
    this.detail.set(null);
    this.creating.set(true);
    this.editing.set(true);
    this.tab.set('identity');
    this.formError.set(null);
    this.mediaMsg.set(null);
  }
  closePopup(): void {
    this.detail.set(null);
    this.editing.set(false);
    this.creating.set(false);
  }
  get popupOpen(): boolean { return this.creating() || this.detail() !== null; }

  startEditing(p: AdminProduct): void {
    if (!this.canEdit) return;
    this.form = this.toForm(p);
    this.editing.set(true);
    this.formError.set(null);
  }
  cancelEditing(): void {
    if (this.creating()) { this.closePopup(); return; }
    this.editing.set(false);
    this.formError.set(null);
  }

  // category change: clear a sub-category that no longer belongs, and pre-fill the spec template when none is set
  onCategoryChange(key: string): void {
    this.form.category = key;
    if (!this.subs(key).some((s) => s.key === this.form.subcategory)) this.form.subcategory = '';
  }
  subs(cat: string) { return this.categories().find((c) => c.key === cat)?.subcategories ?? []; }
  useSpecTemplate(): void {
    const t = this.categories().find((c) => c.key === this.form.category)?.specTemplate ?? [];
    const have = new Set(this.form.specifications.map((r) => (r.label ?? '').toLowerCase()));
    for (const label of t) if (!have.has(label.toLowerCase())) this.form.specifications.push({ label, value: '' });
  }

  addRow(list: Row[], blank: Row): void { list.push({ ...blank }); }
  removeRow(list: Row[], i: number): void { list.splice(i, 1); }
  hasSuitable(s: string): boolean { return this.form.suitableFor.includes(s); }
  toggleSuitable(s: string): void {
    const i = this.form.suitableFor.indexOf(s);
    if (i >= 0) this.form.suitableFor.splice(i, 1); else this.form.suitableFor.push(s);
  }

  private payload(): Record<string, unknown> {
    const f = this.form;
    const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
    const commas = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
    const num = (v: number | null) => (v === null || (v as unknown) === '' ? null : Number(v));
    return {
      name: f.name, category: f.category, subcategory: f.subcategory, brand: f.brand, tags: commas(f.tags), status: f.status, isVerified: f.isVerified,
      unit: f.unit, price: num(f.price) ?? 0, mrp: num(f.mrp) ?? 0, stock: num(f.stock) ?? 0, offerPrice: num(f.offerPrice), offerEndsAt: f.offerEndsAt || null,
      gstRate: num(f.gstRate), hsnCode: f.hsnCode,
      shortDescription: f.shortDescription, highlights: lines(f.highlights), description: f.description, howToUse: f.howToUse, warnings: f.warnings,
      suitableFor: f.suitableFor, form: f.form, storage: f.storage, shelfLifeMonths: num(f.shelfLifeMonths), manufacturer: f.manufacturer,
      countryOfOrigin: f.countryOfOrigin, licenceNo: f.licenceNo, certifications: commas(f.certifications), withdrawalPeriodDays: num(f.withdrawalPeriodDays),
      videoUrl: f.videoUrl, composition: f.composition, dosage: f.dosage, specifications: f.specifications, faqs: f.faqs,
      codAvailable: f.codAvailable, cancellableUntilShipped: f.cancellableUntilShipped, deliveryEstimateDays: num(f.deliveryEstimateDays), freeDelivery: f.freeDelivery,
      contentSource: f.contentSource,
    };
  }

  save(): void {
    if (!this.canEdit) return;
    this.saving.set(true);
    this.formError.set(null);
    const existing = this.detail();
    const req = existing
      ? this.http.put<{ data: AdminProduct }>(`${this.url}/product/${existing._id}`, this.payload())
      : this.http.post<{ data: AdminProduct }>(`${this.url}/product`, this.payload());
    req.subscribe({
      next: (res) => {
        this.saving.set(false);
        if (existing) {
          // the PUT returns the stored product; refresh through the list so quality / review flags are recomputed
          this.detail.set({ ...existing, ...res.data });
          this.editing.set(false);
          this.load();
          this.refreshDetail(res.data._id);
        } else {
          this.creating.set(false);
          this.editing.set(false);
          this.load();
          this.refreshDetail(res.data._id, true);
        }
      },
      error: (err) => { this.formError.set(apiErrorMessage(err)); this.saving.set(false); },
    });
  }

  // Re-reads one product through the admin list (it carries the computed quality / review flags).
  private refreshDetail(id: string, open = false): void {
    const params = new HttpParams().set('q', this.detail()?.slug || this.form.name).set('limit', 100);
    this.http.get<{ data: { items: AdminProduct[] } }>(`${this.url}/product/admin`, { params }).subscribe({
      next: (r) => {
        const fresh = r.data.items.find((p) => p._id === id);
        if (fresh) {
          this.detail.set(fresh);
          this.items.set(this.items().map((p) => (p._id === id ? fresh : p)));
          // right after creating, stay in edit mode on the Media tab so images can be added straight away
          if (open) { this.form = this.toForm(fresh); this.syncAlts(fresh); this.editing.set(true); this.tab.set('media'); }
        }
      },
    });
  }

  archive(p: AdminProduct): void {
    if (!this.canEdit || !confirm(`Archive "${p.name}"? It disappears from the app; past orders keep their copy.`)) return;
    this.http.delete(`${this.url}/product/${p._id}`).subscribe({
      next: () => { this.closePopup(); this.load(); },
      error: (err) => this.formError.set(apiErrorMessage(err)),
    });
  }

  // ── media ──
  mediaMsg = signal<string | null>(null);
  mediaBusy = signal(false);
  altDraft: string[] = [];

  // Called when the Media tab is shown or the gallery changes: keeps the editable alt text in step with the product.
  syncAlts(p: AdminProduct): void {
    this.altDraft = p.images.map((_, i) => p.imageAlts?.[i] ?? '');
  }
  async onFiles(ev: Event): Promise<void> {
    const p = this.detail();
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!p || files.length === 0 || !this.canEdit) return;
    this.mediaMsg.set(null);
    this.mediaBusy.set(true);
    let current = p;
    let done = 0;
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { this.mediaMsg.set(`${file.name}: only JPEG, PNG or WebP`); continue; }
      if (file.size > 5 * 1024 * 1024) { this.mediaMsg.set(`${file.name}: must be under 5 MB`); continue; }
      if (current.images.length >= MAX_IMAGES) { this.mediaMsg.set(`A product can have at most ${MAX_IMAGES} images`); break; }
      const fd = new FormData();
      fd.append('image', file);
      try {
        const res = await firstValueFrom(this.http.post<{ data: AdminProduct }>(`${this.url}/product/${p._id}/images`, fd));
        current = { ...current, ...res.data };
        done++;
      } catch (err) { this.mediaMsg.set(apiErrorMessage(err)); break; }
    }
    this.mediaBusy.set(false);
    this.detail.set(current);
    this.syncAlts(current);
    this.items.set(this.items().map((x) => (x._id === current._id ? { ...x, images: current.images } : x)));
    if (done && !this.mediaMsg()) this.mediaMsg.set(`${done} image${done > 1 ? 's' : ''} uploaded`);
  }
  move(p: AdminProduct, from: number, to: number): void {
    if (to < 0 || to >= p.images.length) return;
    const images = [...p.images]; const alts = [...this.altDraft];
    [images[from], images[to]] = [images[to], images[from]];
    [alts[from], alts[to]] = [alts[to], alts[from]];
    this.detail.set({ ...p, images, imageAlts: alts });
    this.altDraft = alts;
  }
  makePrimary(p: AdminProduct, i: number): void { while (i > 0) { this.move(this.detail()!, i, i - 1); i--; } }
  saveOrder(p: AdminProduct): void {
    this.mediaBusy.set(true);
    const images = p.images.map((url, i) => ({ url, alt: this.altDraft[i] ?? '' }));
    this.http.put<{ data: AdminProduct }>(`${this.url}/product/${p._id}/images/order`, { images }).subscribe({
      next: (res) => { this.detail.set({ ...p, ...res.data }); this.mediaBusy.set(false); this.mediaMsg.set('Order and alt text saved'); this.load(); },
      error: (err) => { this.mediaMsg.set(apiErrorMessage(err)); this.mediaBusy.set(false); },
    });
  }
  removeImage(p: AdminProduct, url: string): void {
    if (!confirm('Remove this image?')) return;
    this.http.request<{ data: AdminProduct }>('DELETE', `${this.url}/product/${p._id}/images`, { body: { imageUrl: url } }).subscribe({
      next: (res) => { const next = { ...p, ...res.data }; this.detail.set(next); this.syncAlts(next); this.mediaMsg.set('Image removed'); this.load(); },
      error: (err) => this.mediaMsg.set(apiErrorMessage(err)),
    });
  }

  // ── veterinary review ──
  reviewer = '';
  reviewNote = '';
  reviewMsg = signal<string | null>(null);
  recordReview(p: AdminProduct): void {
    if (!this.canEdit) return;
    this.reviewMsg.set(null);
    this.http.put<{ data: AdminProduct }>(`${this.url}/product/${p._id}/content-review`, { reviewedBy: this.reviewer, note: this.reviewNote }).subscribe({
      next: (res) => { this.detail.set({ ...p, ...res.data, isReviewed: true }); this.reviewer = ''; this.reviewNote = ''; this.reviewMsg.set('Review recorded'); this.load(); this.refreshDetail(p._id); },
      error: (err) => this.reviewMsg.set(apiErrorMessage(err)),
    });
  }

  // ── CSV import ──
  showImport = signal(false);
  importFile = signal('');
  importRows: Array<Record<string, string>> = [];
  importBusy = signal(false);
  importProgress = signal('');
  importError = signal<string | null>(null);
  preview = signal<ImportSummary | null>(null);
  importDone = signal<ImportSummary | null>(null);

  toggleImport(): void {
    this.showImport.set(!this.showImport());
    this.resetImport();
  }
  private resetImport(): void {
    this.importFile.set(''); this.importRows = []; this.preview.set(null); this.importDone.set(null); this.importError.set(null); this.importProgress.set('');
  }
  downloadTemplate(): void {
    const blob = new Blob(['﻿' + IMPORT_COLUMNS.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dairy-shop-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async onImportFile(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    this.resetImport();
    if (!file) return;
    this.importFile.set(file.name);
    const rows = parseCsv(await file.text());
    if (rows.length === 0) { this.importError.set('The file has no data rows.'); return; }
    const head = Object.keys(rows[0]).filter((h) => h !== '__line');
    const missing = ['name', 'category', 'price', 'mrp'].filter((c) => !head.includes(c));
    if (missing.length) { this.importError.set(`Missing required column(s): ${missing.join(', ')}`); return; }
    const unknown = head.filter((h) => !IMPORT_COLUMNS.includes(h));
    if (unknown.length) { this.importError.set(`Unknown column(s): ${unknown.join(', ')} — download the template for the exact names.`); return; }
    this.importRows = rows;
    await this.runImport(false);
  }
  async runImport(apply: boolean): Promise<void> {
    this.importBusy.set(true);
    this.importError.set(null);
    const sum: ImportSummary = { total: 0, toAdd: 0, toUpdate: 0, forcedDraft: 0, errors: [], added: 0, updated: 0 };
    try {
      for (let i = 0; i < this.importRows.length; i += BATCH) {
        this.importProgress.set(`${apply ? 'Importing' : 'Checking'} ${Math.min(i + BATCH, this.importRows.length)} of ${this.importRows.length}…`);
        const res = await firstValueFrom(this.http.post<{ data: ImportSummary }>(`${this.url}/product/admin/import`, { rows: this.importRows.slice(i, i + BATCH), apply }));
        const d = res.data;
        sum.total += d.total; sum.toAdd += d.toAdd; sum.toUpdate += d.toUpdate; sum.forcedDraft += d.forcedDraft ?? 0;
        sum.errors.push(...d.errors); sum.added = (sum.added ?? 0) + (d.added ?? 0); sum.updated = (sum.updated ?? 0) + (d.updated ?? 0);
      }
      if (apply) { this.importDone.set(sum); this.preview.set(null); this.load(); } else this.preview.set(sum);
    } catch (err) {
      this.importError.set(apiErrorMessage(err));
    } finally {
      this.importBusy.set(false);
      this.importProgress.set('');
    }
  }

  // ── display helpers ──
  v(x: unknown, suffix = ''): string { return x === null || x === undefined || x === '' ? '—' : `${x}${suffix}`; }
  d(x: string | null | undefined): string { return x ? x.slice(0, 10) : '—'; }
  list(x: string[] | undefined): string { return x && x.length ? x.join(', ') : '—'; }
}
