export interface OrderItem {
  name: string;
  category: string;
  quantity: number;
  subtotal: number;
}

export interface Order {
  _id: string;
  farmerId: string;
  items: OrderItem[];
  totalAmount: number;
  discountAmount: number;
  status: string;
  createdAt: string;
}

// Figures no service in godhan-services tracks today (product procurement cost, marketing
// spend, tax/interest/depreciation, market-size assumptions) — admin-entered until a real
// source exists.
export interface FinanceInputs {
  cogsMode: 'percent' | 'amount';
  cogsValue: number;
  marketingSpend: number;
  newCustomers: number;
  fixedOpex: number;
  otherExpenses: number;
  interest: number;
  taxes: number;
  depreciation: number;
  amortization: number;
  addressableFarmers: number;
  avgRevenuePerFarmer: number;
}

export interface MonthlyRevenue {
  label: string;
  revenue: number;
}

export interface FinanceSummary {
  revenue: number;
  orderCount: number;
  monthly: MonthlyRevenue[];
  cogs: number;
  grossMargin: number;
  grossMarginPct: number;
  operatingExpenses: number;
  netProfit: number;
  ebitda: number;
  cac: number | null;
  burnRate: number;
  tam: number;
  marketSharePct: number | null;
}

export function blankFinanceInputs(): FinanceInputs {
  return {
    cogsMode: 'percent',
    cogsValue: 40,
    marketingSpend: 0,
    newCustomers: 0,
    fixedOpex: 0,
    otherExpenses: 0,
    interest: 0,
    taxes: 0,
    depreciation: 0,
    amortization: 0,
    addressableFarmers: 0,
    avgRevenuePerFarmer: 0,
  };
}
