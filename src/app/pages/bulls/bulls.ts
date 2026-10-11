import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
  // Genetic / evaluation data used by the "suggested bulls" feature (all optional).
  dob?: string | null;
  status?: string | null;
  inStock?: boolean | null;
  priceInr?: number | null;
  tpi?: number | null;
  netMerit?: number | null;
  breedingValue?: { value?: number; reliability?: number };
  sscr?: { value?: number; reliability?: number; totalAI?: number };
  pta?: { milkKg?: number; fatKg?: number; proteinKg?: number; fatPct?: number; proteinPct?: number; base?: string };
  pedigree?: { sireId?: string; damYieldBest?: number };
  health?: { a2?: string | null; tests?: Record<string, string | null> };
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
  geneticsId = signal<string | null>(null);
  gen: GeneticsForm = this.blankGenetics();
  genSaving = signal(false);
  genError = signal<string | null>(null);

  private blankGenetics(): GeneticsForm {
    return {
      status: '', inStock: '', dob: '', priceInr: '', bvValue: '', bvReliability: '', sscrValue: '', sscrReliability: '', sscrAI: '',
      ptaMilkKg: '', ptaFatKg: '', ptaProteinKg: '', ptaFatPct: '', ptaBase: '', tpi: '', netMerit: '', a2: '', sireId: '', damYieldBest: '',
      blad: '', cvm: '', dumps: '', citrullinemia: '', factorXI: '',
    };
  }

  startGenetics(b: CatalogBull): void {
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    this.geneticsId.set(b._id);
    this.genError.set(null);
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

  cancelGenetics(): void {
    this.geneticsId.set(null);
  }

  saveGenetics(b: CatalogBull): void {
    const g = this.gen;
    const p: Record<string, unknown> = {};
    const num = (key: string, v: string) => { if (v.trim() !== '' && Number.isFinite(Number(v))) p[key] = Number(v); };
    const txt = (key: string, v: string) => { if (v.trim() !== '') p[key] = v.trim(); };
    txt('status', g.status);
    if (g.inStock) p['inStock'] = g.inStock === 'yes';
    txt('dob', g.dob);
    num('priceInr', g.priceInr);
    num('breedingValue.value', g.bvValue); num('breedingValue.reliability', g.bvReliability);
    if (g.bvValue.trim() !== '') { p['breedingValue.kind'] = 'GBV'; p['breedingValue.trait'] = '305DMY'; }
    num('sscr.value', g.sscrValue); num('sscr.reliability', g.sscrReliability); num('sscr.totalAI', g.sscrAI);
    num('pta.milkKg', g.ptaMilkKg); num('pta.fatKg', g.ptaFatKg); num('pta.proteinKg', g.ptaProteinKg); num('pta.fatPct', g.ptaFatPct); txt('pta.base', g.ptaBase);
    num('tpi', g.tpi); num('netMerit', g.netMerit);
    txt('health.a2', g.a2); txt('pedigree.sireId', g.sireId); num('pedigree.damYieldBest', g.damYieldBest);
    for (const t of DISORDER_TESTS) txt(`health.tests.${t}`, g[t]);
    if (Object.keys(p).length === 0) { this.genError.set('Nothing to save — fill in at least one figure.'); return; }

    this.genSaving.set(true);
    this.genError.set(null);
    this.http.put<{ data: CatalogBull }>(`${API_CONFIG.cattleUrl}/bulls/admin/${b._id}`, p).subscribe({
      next: (res) => {
        this.bulls.set(this.bulls().map((x) => (x._id === b._id ? res.data : x)));
        this.genSaving.set(false);
        this.geneticsId.set(null);
      },
      error: (err) => { this.genError.set(apiErrorMessage(err)); this.genSaving.set(false); },
    });
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
