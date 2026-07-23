import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { FinanceService } from '../../core/finance.service';
import { Order, FinanceInputs } from '../../core/finance.model';
import { apiErrorMessage } from '../../core/api-error';

@Component({
  selector: 'app-finance',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  templateUrl: './finance.html',
  styleUrl: './finance.scss',
})
export class Finance implements OnInit {
  private finance = inject(FinanceService);

  orders = signal<Order[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  inputs = signal<FinanceInputs>(this.finance.loadInputs());

  summary = computed(() => this.finance.computeSummary(this.orders(), this.inputs()));

  chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const monthly = this.summary().monthly;
    return {
      labels: monthly.map((m) => m.label),
      datasets: [
        {
          label: 'Revenue',
          data: monthly.map((m) => m.revenue),
          borderColor: '#14532d',
          backgroundColor: 'rgba(20, 83, 45, 0.1)',
          tension: 0.3,
          fill: true,
        },
      ],
    };
  });

  chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  };

  constructor() {
    // Persist assumptions to localStorage any time they change, same durability the JWT already
    // gets via AuthService — there's no backend endpoint yet to save these to instead.
    effect(() => this.finance.saveInputs(this.inputs()));
  }

  ngOnInit(): void {
    this.finance.loadOrders().subscribe({
      next: (orders) => { this.orders.set(orders); this.loading.set(false); },
      error: (err) => { this.error.set(apiErrorMessage(err)); this.loading.set(false); },
    });
  }

  updateInput<K extends keyof FinanceInputs>(key: K, value: FinanceInputs[K]): void {
    this.inputs.set({ ...this.inputs(), [key]: value });
  }
}
