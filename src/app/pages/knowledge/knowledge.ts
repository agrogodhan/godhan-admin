import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/api-config';
import { apiErrorMessage } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';

// Review of what the chatbot learns from educational videos (cattle-service /knowledge/admin).
// Entries are drafted from video captions; nothing reaches farmers until it is approved here.
//  - An admin approves ordinary guidance (feed, housing, milking, management).
//  - Anything that could hurt an animal or push a purchase (medicine, equipment, a dose, high risk, a brand)
//    can only be approved by a vet. The server decides this from the signed-in role; this page only mirrors it.
interface Draft {
  _id: string;
  title: string;
  topic: string;
  text: string;
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high';
  commercial: boolean;
  products: string[];
  doses: string[];
  needsVet: boolean;
  status: string;
  reviewedBy?: string | null;
  reviewerRole?: string;
  source?: { channel?: string; videoTitle?: string; url?: string; timestampSec?: number | null };
}
interface Guide {
  _id: string;
  title: string;
  topic: string;
  text: string;
  active: boolean;
  reviewedBy?: string | null;
  reviewerRole?: string;
  riskLevel?: string;
  source?: { url?: string };
}
type Tab = 'pending' | 'approved' | 'rejected' | 'live';

const TOPICS = ['health', 'feed', 'breeding', 'medicine', 'equipment', 'housing', 'milking', 'management'];
const PAGE = 20;

@Component({
  selector: 'app-knowledge',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './knowledge.html',
  styleUrl: './knowledge.scss',
})
export class Knowledge implements OnInit {
  private http = inject(HttpClient);
  auth = inject(AuthService);

  topics = TOPICS;
  tab = signal<Tab>('pending');
  drafts = signal<Draft[]>([]);
  guides = signal<Guide[]>([]);
  counts = signal<Record<string, number>>({ pending: 0, approved: 0, rejected: 0 });
  loading = signal(true);
  error = signal<string | null>(null);
  busyId = signal<string | null>(null);
  notice = signal<string | null>(null);

  search = signal('');
  topicFilter = signal('');
  vetOnly = signal(false);
  limit = signal(PAGE);

  // What this person may do. The server enforces it too.
  isVet = computed(() => this.auth.isVet);

  visibleDrafts = computed(() => {
    const q = this.search().trim().toLowerCase();
    const topic = this.topicFilter();
    return this.drafts().filter((d) => {
      if (topic && d.topic !== topic) return false;
      if (this.vetOnly() && !d.needsVet) return false;
      return !q || `${d.title} ${d.text} ${d.tags.join(' ')}`.toLowerCase().includes(q);
    });
  });
  shownDrafts = computed(() => this.visibleDrafts().slice(0, this.limit()));

  visibleGuides = computed(() => {
    const q = this.search().trim().toLowerCase();
    const topic = this.topicFilter();
    return this.guides().filter((g) => (!topic || g.topic === topic) && (!q || `${g.title} ${g.text}`.toLowerCase().includes(q)));
  });
  shownGuides = computed(() => this.visibleGuides().slice(0, this.limit()));

  // Editing one draft at a time.
  editingId = signal<string | null>(null);
  edit = { title: '', text: '', tags: '', topic: 'health', riskLevel: 'low' as Draft['riskLevel'], commercial: false };
  editError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    this.limit.set(PAGE);
    this.editingId.set(null);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const base = `${API_CONFIG.cattleUrl}/knowledge/admin`;
    if (this.tab() === 'live') {
      this.http.get<{ data: Guide[] }>(`${base}/docs`).subscribe({
        next: (r) => { this.guides.set(r.data); this.loading.set(false); },
        error: (e) => { this.error.set(apiErrorMessage(e)); this.loading.set(false); },
      });
      return;
    }
    this.http.get<{ data: { drafts: Draft[]; counts: Record<string, number> } }>(`${base}/drafts?status=${this.tab()}`).subscribe({
      next: (r) => { this.drafts.set(r.data.drafts); this.counts.set(r.data.counts); this.loading.set(false); },
      error: (e) => { this.error.set(apiErrorMessage(e)); this.loading.set(false); },
    });
  }

  more(): void {
    this.limit.set(this.limit() + PAGE);
  }

  // Approve is available when this person may publish it: anyone for ordinary guidance, only a vet for the rest.
  canApprove(d: Draft): boolean {
    return d.status === 'pending' && (!d.needsVet || this.isVet());
  }

  approvalNote(d: Draft): string {
    return d.needsVet && !this.isVet() ? 'Needs a vet: medicine, equipment, dose, high risk or a brand.' : '';
  }

  approve(d: Draft): void {
    this.act(d, 'approve', 'Approved. The chatbot can use it now.');
  }

  reject(d: Draft): void {
    this.act(d, 'reject', 'Rejected.');
  }

  private act(d: Draft, action: 'approve' | 'reject', done: string): void {
    this.busyId.set(d._id);
    this.error.set(null);
    this.http.post(`${API_CONFIG.cattleUrl}/knowledge/admin/drafts/${d._id}/${action}`, {}).subscribe({
      next: () => {
        this.drafts.set(this.drafts().filter((x) => x._id !== d._id));
        const c = { ...this.counts() };
        c['pending'] = Math.max(0, (c['pending'] || 0) - 1);
        const key = action === 'approve' ? 'approved' : 'rejected';
        c[key] = (c[key] || 0) + 1;
        this.counts.set(c);
        this.busyId.set(null);
        this.notice.set(done);
      },
      error: (e) => { this.error.set(apiErrorMessage(e)); this.busyId.set(null); },
    });
  }

  startEdit(d: Draft): void {
    this.editingId.set(d._id);
    this.editError.set(null);
    this.edit = { title: d.title, text: d.text, tags: d.tags.join(', '), topic: d.topic, riskLevel: d.riskLevel, commercial: d.commercial };
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(d: Draft): void {
    this.busyId.set(d._id);
    this.editError.set(null);
    const body: Record<string, unknown> = {
      title: this.edit.title,
      text: this.edit.text,
      tags: this.edit.tags.split(',').map((t) => t.trim()).filter((t) => t),
    };
    // Only a vet may change these; the server refuses them from anyone else.
    if (this.isVet()) {
      body['topic'] = this.edit.topic;
      body['riskLevel'] = this.edit.riskLevel;
      body['commercial'] = this.edit.commercial;
    }
    this.http.put<{ data: Draft }>(`${API_CONFIG.cattleUrl}/knowledge/admin/drafts/${d._id}`, body).subscribe({
      next: (r) => {
        this.drafts.set(this.drafts().map((x) => (x._id === d._id ? { ...x, ...r.data } : x)));
        this.busyId.set(null);
        this.editingId.set(null);
      },
      error: (e) => { this.editError.set(apiErrorMessage(e)); this.busyId.set(null); },
    });
  }

  toggleGuide(g: Guide): void {
    this.busyId.set(g._id);
    this.error.set(null);
    this.http.put<{ data: Guide }>(`${API_CONFIG.cattleUrl}/knowledge/admin/docs/${g._id}/active`, { active: !g.active }).subscribe({
      next: (r) => {
        this.guides.set(this.guides().map((x) => (x._id === g._id ? { ...x, active: r.data.active } : x)));
        this.busyId.set(null);
      },
      error: (e) => { this.error.set(apiErrorMessage(e)); this.busyId.set(null); },
    });
  }

  clock(sec?: number | null): string {
    if (!sec) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
}
