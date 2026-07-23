import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, expand, reduce, map, of, EMPTY } from 'rxjs';
import { API_CONFIG } from './api-config';
import { Order, FinanceInputs, FinanceSummary, MonthlyRevenue, blankFinanceInputs } from './finance.model';

interface OrdersResponse {
  data: { items: Order[]; page: number; hasMore: boolean; total: number };
}

const REVENUE_STATUSES = new Set(['paid', 'delivered']);
const MAX_PAGES = 5; // safety cap: 5 * 100 = 500 most recent orders, see finance.model.ts note
const INPUTS_KEY = 'godhan-finance-inputs';

@Injectable({ providedIn: 'root' })
export class FinanceService {
  private http = inject(HttpClient);

  // Pages through the admin-only /order/all endpoint (already used by orders.ts/dashboard.ts)
  // up to MAX_PAGES, since it has no date-range filter to ask for "this year's orders" directly.
  loadOrders(): Observable<Order[]> {
    const fetchPage = (page: number) =>
      this.http.get<OrdersResponse>(`${API_CONFIG.marketplaceUrl}/order/all`, { params: { page, limit: 100 } });

    return fetchPage(1).pipe(
      expand((res) => (res.data.hasMore && res.data.page < MAX_PAGES ? fetchPage(res.data.page + 1) : EMPTY)),
      reduce((acc: Order[], res) => [...acc, ...res.data.items], []),
    );
  }

  computeSummary(orders: Order[], inputs: FinanceInputs): FinanceSummary {
    const realized = orders.filter((o) => REVENUE_STATUSES.has(o.status));
    const revenue = realized.reduce((sum, o) => sum + o.totalAmount, 0);

    const monthly = this.groupByMonth(realized);

    const cogs = inputs.cogsMode === 'percent' ? revenue * (inputs.cogsValue / 100) : inputs.cogsValue;
    const grossMargin = revenue - cogs;
    const grossMarginPct = revenue > 0 ? (grossMargin / revenue) * 100 : 0;

    const operatingExpenses = inputs.marketingSpend + inputs.fixedOpex + inputs.otherExpenses;
    const netProfit = grossMargin - operatingExpenses;
    const ebitda = netProfit + inputs.interest + inputs.taxes + inputs.depreciation + inputs.amortization;

    const cac = inputs.newCustomers > 0 ? inputs.marketingSpend / inputs.newCustomers : null;
    const burnRate = operatingExpenses - revenue;

    const tam = inputs.addressableFarmers * inputs.avgRevenuePerFarmer;
    const marketSharePct = tam > 0 ? (revenue / tam) * 100 : null;

    return {
      revenue,
      orderCount: realized.length,
      monthly,
      cogs,
      grossMargin,
      grossMarginPct,
      operatingExpenses,
      netProfit,
      ebitda,
      cac,
      burnRate,
      tam,
      marketSharePct,
    };
  }

  private groupByMonth(orders: Order[]): MonthlyRevenue[] {
    const totals = new Map<string, number>();
    for (const order of orders) {
      const d = new Date(order.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      totals.set(key, (totals.get(key) ?? 0) + order.totalAmount);
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, revenue]) => ({ label, revenue }));
  }

  loadInputs(): FinanceInputs {
    const raw = localStorage.getItem(INPUTS_KEY);
    if (!raw) return blankFinanceInputs();
    try {
      return { ...blankFinanceInputs(), ...JSON.parse(raw) };
    } catch {
      return blankFinanceInputs();
    }
  }

  saveInputs(inputs: FinanceInputs): void {
    localStorage.setItem(INPUTS_KEY, JSON.stringify(inputs));
  }
}
