import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Customer, CustomersService } from '../customers/customers.service';
import { Expense, ExpensesService } from '../expenses/expenses.service';
import { Purchase, PurchasesService } from '../purchases/purchases.service';
import { PurchasePayment, PurchasePaymentsService } from '../purchases/purchase-payments.service';
import { Product, ProductsService } from '../products/products.service';
import { Receipt, ReceiptCustomerRef, ReceiptsService } from '../receipts/receipts.service';
import { computeReceiptProfitTotals } from '../receipts/receipt-math';

type WeekDayPoint = {
  label: string;
  total: number;
};

type ChartPoint = {
  x: number;
  y: number;
};

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, CardModule, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly productsService = inject(ProductsService);
  private readonly customersService = inject(CustomersService);
  private readonly expensesService = inject(ExpensesService);
  private readonly purchasesService = inject(PurchasesService);
  private readonly purchasePaymentsService = inject(PurchasePaymentsService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly receipts = signal<Receipt[]>([]);
  readonly products = signal<Product[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly expenses = signal<Expense[]>([]);
  readonly purchases = signal<Purchase[]>([]);
  readonly purchasePayments = signal<PurchasePayment[]>([]);

  readonly todaySales = computed(() => this.sumReceiptsForDay(new Date(), 'grandTotal'));
  readonly monthlySales = computed(() => this.sumReceiptsForMonth(new Date(), 'grandTotal'));
  readonly todayExpenses = computed(() => this.sumExpensesForDay(new Date()));
  readonly monthlyExpenses = computed(() => this.sumExpensesForMonth(new Date()));
  readonly monthlyGrossProfit = computed(() => this.sumProfitForMonth(new Date()));
  readonly monthlyNetProfit = computed(() => this.monthlyGrossProfit() - this.monthlyExpenses());
  readonly monthlyPurchasePaid = computed(() => this.sumSupplierPaymentsForMonth(new Date()));
  readonly supplierCreditOutstanding = computed(() =>
    this.purchases().reduce((sum, p) => sum + Math.max(0, p.remainingAmount), 0),
  );
  readonly revenueLast30Days = computed(() => this.sumReceiptsLastDays(30, 'grandTotal'));
  readonly totalCustomers = computed(() => this.customers().length);
  readonly newCustomersThisMonth = computed(() => {
    const now = new Date();
    return this.customers().filter((c) => c.createdAt && this.isSameMonth(c.createdAt, now)).length;
  });

  readonly topSellingProducts = computed(() => {
    const qtyByProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const r of this.receipts()) {
      if (r.type === 'refund') continue;
      for (const l of r.lines) {
        const cur = qtyByProduct.get(l.productId) ?? { name: l.productName, qty: 0, revenue: 0 };
        cur.qty += Math.abs(l.quantity);
        cur.revenue += l.unitPrice * Math.abs(l.quantity);
        qtyByProduct.set(l.productId, cur);
      }
    }
    return [...qtyByProduct.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  });

  readonly paymentBreakdown = computed(() => {
    const map = new Map<string, number>();
    for (const r of this.receipts()) {
      if (!r.createdAt || !this.isSameMonth(r.createdAt, new Date())) continue;
      const key = (r.paymentMethod || 'cash').toLowerCase();
      map.set(key, (map.get(key) ?? 0) + r.totals.grandTotal);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  readonly expenseBreakdown = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.expenses()) {
      if (!e.date || !this.isSameMonth(e.date, new Date())) continue;
      const key = e.categoryId || 'uncategorized';
      map.set(key, (map.get(key) ?? 0) + e.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  readonly expiryAlerts = computed(() => {
    const now = new Date();
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    return this.products().filter((p) => {
      if (!p.hasExpiry || !p.expiryDate) return false;
      const exp = new Date(p.expiryDate);
      return exp <= in30;
    });
  });

  readonly lowStockCount = computed(
    () => this.products().filter((p) => p.stockInBaseUnit <= p.lowStockThreshold).length,
  );

  readonly lowStockAlerts = computed(() =>
    [...this.products()]
      .filter((p) => p.stockInBaseUnit <= p.lowStockThreshold)
      .sort((a, b) => a.stockInBaseUnit - b.stockInBaseUnit)
      .slice(0, 6),
  );

  readonly weeklyRevenue = computed((): WeekDayPoint[] => {
    const points: WeekDayPoint[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      points.push({
        label: day.toLocaleDateString('en-US', { weekday: 'short' }),
        total: this.sumSalesForDay(day),
      });
    }
    return points;
  });

  readonly chartLinePoints = computed(() => this.buildChartPoints(this.weeklyRevenue(), 560, 200, 24));
  readonly chartAreaPath = computed(() => this.buildAreaPath(this.chartLinePoints()));
  readonly chartPolyline = computed(() => this.chartLinePoints().map((p) => `${p.x},${p.y}`).join(' '));

  readonly recentTransactions = computed(() => this.receipts().slice(0, 8));
  readonly totalReceiptCount = computed(() => this.receipts().length);

  readonly todayLabel = computed(() =>
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  );

  constructor() {
    void this.subscribeWhenAuthReady();
  }

  private async subscribeWhenAuthReady(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }

    this.receiptsService
      .watchReceipts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.receipts.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });

    this.productsService
      .watchProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.products.set(rows),
        error: () => {},
      });

    this.customersService
      .watchCustomers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.customers.set(rows),
        error: () => {},
      });

    this.expensesService
      .watchExpenses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.expenses.set(rows),
        error: () => {},
      });

    this.purchasesService
      .watchPurchases()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.purchases.set(rows),
        error: () => {},
      });

    this.purchasePaymentsService
      .watchPurchasePayments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.purchasePayments.set(rows),
        error: () => {},
      });
  }

  formatRs(amount: number): string {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}Rs. ${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 100_000) return `${sign}Rs. ${Math.round(abs / 1000).toLocaleString('en-PK')}k`;
    return `${sign}Rs. ${abs.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
  }

  productStockLabel(p: Product): string {
    if (p.type === 'count') {
      const units = Math.floor(p.stockInBaseUnit);
      return `${units} ${units === 1 ? 'unit' : 'units'} left`;
    }
    const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
    const qty = (p.stockInBaseUnit / cf).toFixed(1);
    return `${qty} ${p.sellingUnit} left`;
  }

  displayCustomer(c: ReceiptCustomerRef): string {
    const name = c.mode === 'registered' ? c.fullName || 'Customer' : c.fullName || 'Guest';
    return name;
  }

  customerWithCredit(r: Receipt): string {
    const name = this.displayCustomer(r.customer);
    if (r.totals.remainingAmount > 0) {
      return `${name} (Udhaar)`;
    }
    return name;
  }

  transactionStatus(r: Receipt): 'Paid' | 'Pending' | 'Refund' {
    if (r.type === 'refund') return 'Refund';
    if (r.totals.remainingAmount > 0) return 'Pending';
    return 'Paid';
  }

  paymentMethodClass(method: string): string {
    const m = (method || '').toLowerCase();
    if (m.includes('cash')) return 'pay-cash';
    if (m.includes('card')) return 'pay-card';
    if (m.includes('bank')) return 'pay-bank';
    if (m.includes('easypaisa')) return 'pay-easypaisa';
    if (m.includes('jazz')) return 'pay-jazz';
    return 'pay-other';
  }

  paymentMethodLabel(method: string): string {
    const m = (method || 'cash').trim();
    if (!m) return 'Cash';
    return m.charAt(0).toUpperCase() + m.slice(1);
  }

  orderId(r: Receipt): string {
    const inv = r.invoiceNumber.trim();
    if (!inv) return `#${r.id.slice(0, 6).toUpperCase()}`;
    return inv.startsWith('#') ? inv : `#${inv}`;
  }

  private sumReceiptsForDay(day: Date, field: 'grandTotal' | 'totalProfit'): number {
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameDay(r.createdAt, day))
      .reduce((sum, r) => sum + (r.totals[field] ?? 0), 0);
  }

  private sumSupplierPaymentsForMonth(day: Date): number {
    return this.purchasePayments()
      .filter((p) => p.createdAt && this.isSameMonth(p.createdAt, day))
      .reduce((sum, p) => sum + p.amount, 0);
  }

  private sumProfitForMonth(day: Date): number {
    const products = this.products();
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameMonth(r.createdAt, day))
      .reduce((sum, r) => sum + this.profitForReceipt(r, products), 0);
  }

  private profitForReceipt(r: Receipt, products: Product[]): number {
    const stored = r.totals.totalProfit;
    if (stored !== 0 || r.lines.length === 0) {
      return stored;
    }
    return computeReceiptProfitTotals(r.lines, products).totalProfit;
  }

  private sumReceiptsForMonth(day: Date, field: 'grandTotal' | 'totalProfit'): number {
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameMonth(r.createdAt, day))
      .reduce((sum, r) => sum + (r.totals[field] ?? 0), 0);
  }

  private sumReceiptsLastDays(days: number, field: 'grandTotal' | 'totalProfit'): number {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.receipts()
      .filter((r) => r.createdAt && r.createdAt >= since)
      .reduce((sum, r) => sum + (r.totals[field] ?? 0), 0);
  }

  private sumExpensesForDay(day: Date): number {
    return this.expenses()
      .filter((e) => e.date && this.isSameDay(e.date, day))
      .reduce((sum, e) => sum + e.amount, 0);
  }

  private sumExpensesForMonth(day: Date): number {
    return this.expenses()
      .filter((e) => e.date && this.isSameMonth(e.date, day))
      .reduce((sum, e) => sum + e.amount, 0);
  }

  private sumSalesForDay(day: Date): number {
    return this.sumReceiptsForDay(day, 'grandTotal');
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private isSameMonth(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  private buildChartPoints(data: WeekDayPoint[], width: number, height: number, pad: number): ChartPoint[] {
    if (data.length === 0) return [];
    const max = Math.max(...data.map((d) => d.total), 1);
    const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
    return data.map((d, i) => ({
      x: pad + i * step,
      y: pad + (height - pad * 2) * (1 - d.total / max),
    }));
  }

  private buildAreaPath(points: ChartPoint[]): string {
    if (points.length === 0) return '';
    const baseY = 200 - 24;
    const first = points[0];
    const last = points[points.length - 1];
    const line = points.map((p) => `${p.x},${p.y}`).join(' L ');
    return `M ${first.x},${baseY} L ${line} L ${last.x},${baseY} Z`;
  }
}
