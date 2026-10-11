import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';

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
  // Genetic / evaluation data used by the "suggested bulls" feature (all optional).
  dob?: string | null;
  status?: string | null;
  inStock?: boolean | null;
  priceInr?: number | null;
  tpi?: number | null;
  netMerit?: number | null;
  origin?: string | null;
  exoticLevelPct?: number | null;
  starRating?: number | null;
  priceAsOf?: string | null;
  semenTypes?: string[];
  breedingValue?: { value?: number; reliability?: number; kind?: string | null; trait?: string; evaluatedOn?: string | null; sourceUrl?: string };
  sscr?: { value?: number; reliability?: number; totalAI?: number; breedAverage?: number; projects?: string[]; evaluatedOn?: string | null; sourceUrl?: string };
  pta?: {
    milkKg?: number; fatKg?: number; proteinKg?: number; fatPct?: number; proteinPct?: number; productiveLife?: number;
    dpr?: number; scs?: number; calvingEase?: number; base?: string;
  };
  pedigree?: { sireName?: string; sireId?: string; damId?: string; damYieldFirst?: number; damYieldBest?: number; damFatPct?: number };
  health?: { karyotyped?: boolean | null; a2?: string | null; tests?: Record<string, string | null> };
  dataSources?: Array<{ name?: string; url?: string; asOf?: string | null }>;
}

// What the Genetics editor edits. Every field is a string: '' means "leave as it is" (a blank never clears a
// stored figure — clear it in the database if it was wrong).
interface GeneticsForm {
  status: string; inStock: string; dob: string; priceInr: string;
  bvValue: string; bvReliability: string; sscrValue: string; sscrReliability: string; sscrAI: string;
  ptaMilkKg: string; ptaFatKg: string; ptaProteinKg: string; ptaFatPct: string; ptaBase: string;
  tpi: string; netMerit: string; a2: string; sireId: string; damYieldBest: string;
  blad: string; cvm: string; dumps: string; citrullinemia: string; factorXI: string;
}
const TEST_STATES = ['clear', 'carrier', 'untested'] as const;
const DISORDER_TESTS = ['blad', 'cvm', 'dumps', 'citrullinemia', 'factorXI'] as const;

// One entry of the shared breed master (cattle-service GET /breeds) — the only breeds a bull may
// have, so a catalog bull can never carry a spelling the app's breed lists don't know.
interface BreedOption {
  name: string;
  type: string;
}

// Columns of the bulk-import CSV — must match cattle-service/services/bullImport.js.
const IMPORT_COLUMNS =
  ('type,breed,brand,name,tag,registrationNumber,dob,semenTypes,origin,status,inStock,priceInr,priceAsOf,exoticLevelPct,starRating,' +
  'breedingValue.value,breedingValue.reliability,breedingValue.kind,breedingValue.trait,breedingValue.evaluatedOn,breedingValue.sourceUrl,' +
  'sscr.value,sscr.reliability,sscr.totalAI,sscr.breedAverage,sscr.projects,sscr.evaluatedOn,sscr.sourceUrl,' +
  'pta.milkKg,pta.fatKg,pta.proteinKg,pta.fatPct,pta.proteinPct,pta.productiveLife,pta.dpr,pta.scs,pta.calvingEase,pta.base,tpi,netMerit,' +
  'pedigree.sireName,pedigree.sireId,pedigree.damId,pedigree.damYieldFirst,pedigree.damYieldBest,pedigree.damFatPct,' +
  'health.karyotyped,health.tests.blad,health.tests.cvm,health.tests.dumps,health.tests.citrullinemia,health.tests.factorXI,health.a2,' +
  'notes,source,sourceUrl').split(',');
const IMPORT_BATCH = 300; // the server caps one request at 300 rows

interface ImportSummary {
  total: number; toAdd: number; toUpdate: number;
  errors: Array<{ line: number; tag: string; message: string }>;
  added?: number; updated?: number;
}

// Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF, BOM).
function parseCsv(text: string): Array<Record<string, string>> {
  const recs: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); field = ''; recs.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); recs.push(row); }
  const head = (recs.shift() ?? []).map((h) => h.trim());
  return recs
    .map((r, n) => ({ r, line: n + 2 }))
    .filter(({ r }) => r.some((v) => v.trim() !== ''))
    .map(({ r, line }) => ({ ...Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])), __line: line as unknown as string }));
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
  breeds = signal<BreedOption[]>([]);
  loading = signal(true);

  // ── Filters + pagination (the catalog is ~1,500 bulls; filtering and paging are done in the browser) ──
  search = signal('');
  fType = signal('');
  fBreed = signal('');
  fBrand = signal('');
  fData = signal('');
  page = signal(1);
  pageSize = signal(25);
  pageSizes = [25, 50, 100];
  dataFilters: Array<[string, string]> = [
    ['bv', 'Has breeding value'], ['tpi', 'Has TPI / Net Merit'], ['pta', 'Has PTAs'], ['sscr', 'Has conception rate'],
    ['pedigree', 'Has sire / dam data'], ['a2', 'Has A2 status'], ['price', 'Has price'], ['none', 'No genetics at all'],
  ];

  // The dropdowns narrow each other: type -> its breeds -> the brands that have that type/breed. Picking
  // "cow" must not offer buffalo breeds, so each list is built only from bulls matching the choices above it.
  breedFilterOptions = computed(() => {
    const type = this.fType();
    return [...new Set(this.bulls().filter((b) => !type || b.type === type).map((b) => b.breed))].sort();
  });
  brandFilterOptions = computed(() => {
    const type = this.fType(), breed = this.fBreed();
    return [...new Set(this.bulls().filter((b) => (!type || b.type === type) && (!breed || b.breed === breed)).map((b) => b.brand).filter(Boolean))].sort();
  });

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const type = this.fType(), breed = this.fBreed(), brand = this.fBrand(), data = this.fData();
    return this.bulls().filter((b) => {
      if (type && b.type !== type) return false;
      if (breed && b.breed !== breed) return false;
      if (brand && b.brand !== brand) return false;
      if (q && !`${b.name} ${b.tag} ${b.brand} ${b.registrationNumber} ${b.breed}`.toLowerCase().includes(q)) return false;
      return !data || this.hasData(b, data);
    });
  });
  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  paged = computed(() => {
    const start = (Math.min(this.page(), this.totalPages()) - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });
  rangeLabel = computed(() => {
    const n = this.filtered().length;
    if (n === 0) return '0 bulls';
    const start = (Math.min(this.page(), this.totalPages()) - 1) * this.pageSize();
    return `${start + 1}–${Math.min(start + this.pageSize(), n)} of ${n}`;
  });

  private hasData(b: CatalogBull, kind: string): boolean {
    const bv = b.breedingValue?.value != null;
    const tpi = b.tpi != null || b.netMerit != null;
    const pta = b.pta?.milkKg != null;
    const sscr = b.sscr?.value != null;
    const ped = !!(b.pedigree?.sireName || b.pedigree?.sireId || b.pedigree?.damId || b.pedigree?.damYieldBest != null || b.pedigree?.damYieldFirst != null);
    const a2 = !!b.health?.a2;
    const price = b.priceInr != null;
    switch (kind) {
      case 'bv': return bv;
      case 'tpi': return tpi;
      case 'pta': return pta;
      case 'sscr': return sscr;
      case 'pedigree': return ped;
      case 'a2': return a2;
      case 'price': return price;
      case 'none': return !(bv || tpi || pta || sscr || ped || a2 || price);
      default: return true;
    }
  }

  // Changing type/breed can leave a lower-level choice that no longer applies (e.g. breed Murrah after
  // switching to cow) — drop it rather than show an empty list under a stale filter.
  setTypeFilter(v: string): void {
    this.fType.set(v);
    if (this.fBreed() && !this.breedFilterOptions().includes(this.fBreed())) this.fBreed.set('');
    if (this.fBrand() && !this.brandFilterOptions().includes(this.fBrand())) this.fBrand.set('');
    this.page.set(1);
  }
  setBreedFilter(v: string): void {
    this.fBreed.set(v);
    if (this.fBrand() && !this.brandFilterOptions().includes(this.fBrand())) this.fBrand.set('');
    this.page.set(1);
  }

  setFilter(sig: { set(v: string): void }, v: string): void {
    sig.set(v);
    this.page.set(1);
  }
  clearFilters(): void {
    this.search.set(''); this.fType.set(''); this.fBreed.set(''); this.fBrand.set(''); this.fData.set(''); this.page.set(1);
  }
  get filtersActive(): boolean {
    return !!(this.search() || this.fType() || this.fBreed() || this.fBrand() || this.fData());
  }
  goPage(n: number): void {
    this.page.set(Math.min(Math.max(1, n), this.totalPages()));
  }
  setPageSize(n: number): void {
    this.pageSize.set(Number(n));
    this.page.set(1);
  }

  // ── Details popup: view everything stored for a bull; an admin can switch it to edit mode and save ──
  private auth = inject(AuthService);
  detail = signal<CatalogBull | null>(null);
  editing = signal(false);
  get canEdit(): boolean { return this.auth.isAdmin; }

  openDetail(b: CatalogBull): void {
    this.detail.set(b);
    this.editing.set(false);
    this.editError.set(null);
  }
  closeDetail(): void {
    this.detail.set(null);
    this.editing.set(false);
  }
  startEditing(b: CatalogBull): void {
    if (!this.canEdit) return;
    this.editError.set(null);
    this.editForm = {
      breed: b.breed, type: b.type, brand: b.brand, name: b.name, tag: b.tag,
      semenType: b.semenType ?? '', registrationNumber: b.registrationNumber, notes: b.notes,
    };
    this.loadGenetics(b);
    this.editing.set(true);
  }
  cancelEditing(): void {
    this.editing.set(false);
    this.editError.set(null);
  }
  // Shows a number/string, or a dash when it is not recorded.
  v(x: unknown, suffix = ''): string {
    return x === null || x === undefined || x === '' ? '—' : `${x}${suffix}`;
  }
  d(x: string | null | undefined): string {
    return x ? x.slice(0, 10) : '—';
  }
  error = signal<string | null>(null);

  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = this.blankForm();

  editForm = this.blankForm();
  editSaving = signal(false);
  editError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadBreeds();
    this.load();
  }

  private loadBreeds(): void {
    this.http.get<{ data: BreedOption[] }>(`${API_CONFIG.cattleUrl}/breeds`).subscribe({
      next: (res) => this.breeds.set(res.data),
      error: (err) => this.error.set(apiErrorMessage(err)),
    });
  }

  breedsFor(type: string): BreedOption[] {
    return this.breeds().filter((b) => b.type === type);
  }

  // A breed belongs to one animal type, so switching type clears a breed that no longer applies
  // rather than leaving an invalid combination for the server to reject.
  setType(f: { type: 'cow' | 'buffalo'; breed: string }, type: 'cow' | 'buffalo'): void {
    f.type = type;
    if (!this.breedsFor(type).some((b) => b.name === f.breed)) f.breed = '';
  }

  // An edit row for a bull saved before the breed list existed can hold a value that isn't in it —
  // it stays selectable (marked) so opening the row doesn't silently blank the field, and the
  // admin picks a canonical breed to fix it.
  isLegacyBreed(f: { type: string; breed: string }): boolean {
    return !!f.breed && !this.breedsFor(f.type).some((b) => b.name === f.breed);
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
    this.importFile.set('');
    this.importRows = [];
    this.preview.set(null);
    this.importDone.set(null);
    this.importError.set(null);
    this.importProgress.set('');
  }

  downloadTemplate(): void {
    const blob = new Blob(['﻿' + IMPORT_COLUMNS.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bull-import-template.csv';
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
    const missing = ['type', 'breed', 'tag'].filter((c) => !head.includes(c));
    if (missing.length) { this.importError.set(`Missing required column(s): ${missing.join(', ')}`); return; }
    const unknown = head.filter((h) => !IMPORT_COLUMNS.includes(h));
    if (unknown.length) { this.importError.set(`Unknown column(s): ${unknown.join(', ')} — download the template for the exact names.`); return; }
    this.importRows = rows;
    await this.runImport(false);
  }

  // Sends the file in batches; a dry run (apply=false) only validates and counts.
  async runImport(apply: boolean): Promise<void> {
    this.importBusy.set(true);
    this.importError.set(null);
    const sum: ImportSummary = { total: 0, toAdd: 0, toUpdate: 0, errors: [], added: 0, updated: 0 };
    try {
      for (let i = 0; i < this.importRows.length; i += IMPORT_BATCH) {
        this.importProgress.set(`${apply ? 'Importing' : 'Checking'} ${Math.min(i + IMPORT_BATCH, this.importRows.length)} of ${this.importRows.length}…`);
        const res = await firstValueFrom(
          this.http.post<{ data: ImportSummary }>(`${API_CONFIG.cattleUrl}/bulls/admin/import`, { rows: this.importRows.slice(i, i + IMPORT_BATCH), apply }),
        );
        const d = res.data;
        sum.total += d.total;
        sum.toAdd += d.toAdd;
        sum.toUpdate += d.toUpdate;
        sum.errors.push(...d.errors);
        sum.added = (sum.added ?? 0) + (d.added ?? 0);
        sum.updated = (sum.updated ?? 0) + (d.updated ?? 0);
      }
      if (apply) { this.importDone.set(sum); this.preview.set(null); this.load(); } else this.preview.set(sum);
    } catch (err) {
      this.importError.set(apiErrorMessage(err));
    } finally {
      this.importBusy.set(false);
      this.importProgress.set('');
    }
  }

  // ── Genetics editor (inputs of the suggested-bulls ranking) ──
  testStates = TEST_STATES;
  disorderTests = DISORDER_TESTS;
  gen: GeneticsForm = this.blankGenetics();

  private blankGenetics(): GeneticsForm {
    return {
      status: '', inStock: '', dob: '', priceInr: '', bvValue: '', bvReliability: '', sscrValue: '', sscrReliability: '', sscrAI: '',
      ptaMilkKg: '', ptaFatKg: '', ptaProteinKg: '', ptaFatPct: '', ptaBase: '', tpi: '', netMerit: '', a2: '', sireId: '', damYieldBest: '',
      blad: '', cvm: '', dumps: '', citrullinemia: '', factorXI: '',
    };
  }

  private loadGenetics(b: CatalogBull): void {
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    this.gen = {
      status: s(b.status), inStock: b.inStock === true ? 'yes' : b.inStock === false ? 'no' : '', dob: s(b.dob).slice(0, 10), priceInr: s(b.priceInr),
      bvValue: s(b.breedingValue?.value), bvReliability: s(b.breedingValue?.reliability),
      sscrValue: s(b.sscr?.value), sscrReliability: s(b.sscr?.reliability), sscrAI: s(b.sscr?.totalAI),
      ptaMilkKg: s(b.pta?.milkKg), ptaFatKg: s(b.pta?.fatKg), ptaProteinKg: s(b.pta?.proteinKg), ptaFatPct: s(b.pta?.fatPct), ptaBase: s(b.pta?.base),
      tpi: s(b.tpi), netMerit: s(b.netMerit), a2: s(b.health?.a2), sireId: s(b.pedigree?.sireId), damYieldBest: s(b.pedigree?.damYieldBest),
      blad: s(b.health?.tests?.['blad']), cvm: s(b.health?.tests?.['cvm']), dumps: s(b.health?.tests?.['dumps']),
      citrullinemia: s(b.health?.tests?.['citrullinemia']), factorXI: s(b.health?.tests?.['factorXI']),
    };
  }

  // Genetics cells as dotted-path update keys. A blank never clears a stored figure.
  private geneticsPayload(): Record<string, unknown> {
    const g = this.gen;
    const p: Record<string, unknown> = {};
    // type="number" inputs bound with ngModel hold numbers (or null), not strings — normalise before trimming.
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
    const num = (key: string, v: unknown) => { if (str(v) !== '' && Number.isFinite(Number(v))) p[key] = Number(v); };
    const txt = (key: string, v: unknown) => { if (str(v) !== '') p[key] = str(v); };
    txt('status', g.status);
    if (g.inStock) p['inStock'] = g.inStock === 'yes';
    txt('dob', g.dob);
    num('priceInr', g.priceInr);
    num('breedingValue.value', g.bvValue); num('breedingValue.reliability', g.bvReliability);
    if (str(g.bvValue) !== '') { p['breedingValue.kind'] = 'GBV'; p['breedingValue.trait'] = '305DMY'; }
    num('sscr.value', g.sscrValue); num('sscr.reliability', g.sscrReliability); num('sscr.totalAI', g.sscrAI);
    num('pta.milkKg', g.ptaMilkKg); num('pta.fatKg', g.ptaFatKg); num('pta.proteinKg', g.ptaProteinKg); num('pta.fatPct', g.ptaFatPct); txt('pta.base', g.ptaBase);
    num('tpi', g.tpi); num('netMerit', g.netMerit);
    txt('health.a2', g.a2); txt('pedigree.sireId', g.sireId); num('pedigree.damYieldBest', g.damYieldBest);
    for (const t of DISORDER_TESTS) txt(`health.tests.${t}`, g[t]);
    return p;
  }

  // One save for the whole popup: identity fields + genetics in a single admin PUT.
  saveAll(b: CatalogBull): void {
    if (!this.canEdit) return;
    this.editSaving.set(true);
    this.editError.set(null);
    const payload = { ...this.editForm, semenType: this.editForm.semenType || null, ...this.geneticsPayload() };
    this.http.put<{ data: CatalogBull }>(`${API_CONFIG.cattleUrl}/bulls/admin/${b._id}`, payload).subscribe({
      next: (res) => {
        this.bulls.set(this.bulls().map((x) => (x._id === b._id ? res.data : x)));
        this.detail.set(res.data);
        this.editSaving.set(false);
        this.editing.set(false);
      },
      error: (err) => { this.editError.set(apiErrorMessage(err)); this.editSaving.set(false); },
    });
  }
}
