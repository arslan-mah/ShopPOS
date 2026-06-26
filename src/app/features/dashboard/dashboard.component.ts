import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../core/auth/auth.service';
import {
  DateRange,
  DateRangePreset,
  eachDayInRange,
  formatRangeLabel,
  isDateInRange,
  parseDateInputValue,
  presetRange,
  rangeToMs,
  startOfDay,
  toDateInputValue,
} from '../../core/utils/date-range.util';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Customer, CustomersService } from '../customers/customers.service';
import { Expense, ExpensesService } from '../expenses/expenses.service';
import { Purchase, PurchasesService } from '../purchases/purchases.service';
import { PurchasePayment, PurchasePaymentsService } from '../purchases/purchase-payments.service';
import { Product, ProductsService, productInventoryValue } from '../products/products.service';
import { Receipt, ReceiptCustomerRef, ReceiptsService } from '../receipts/receipts.service';
import { computeReceiptProfitTotals } from '../receipts/receipt-math';

type DayPoint = {
  label: string;
  total: number;
};

type ChartPoint = {
  x: number;
  y: number;
};

const RANGE_SHORTCUTS: { preset: DateRangePreset; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: 'yesterday', label: 'Yesterday' },
  { preset: 'thisWeek', label: 'This week' },
  { preset: 'lastWeek', label: 'Last week' },
  { preset: 'thisMonth', label: 'This month' },
  { preset: 'lastMonth', label: 'Last month' },
  { preset: 'custom', label: 'Custom' },
];

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

  readonly rangeShortcuts = RANGE_SHORTCUTS;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly authReady = signal(false);

  readonly dateRange = signal<DateRange>(presetRange('today'));
  readonly customFromInput = signal(toDateInputValue(new Date()));
  readonly customToInput = signal(toDateInputValue(new Date()));

  readonly receipts = signal<Receipt[]>([]);
  readonly products = signal<Product[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly expenses = signal<Expense[]>([]);
  readonly purchases = signal<Purchase[]>([]);
  readonly purchasePayments = signal<PurchasePayment[]>([]);

  private rangeSubs: Subscription[] = [];

  readonly rangeLabel = computed(() => formatRangeLabel(this.dateRange()));

  readonly periodSales = computed(() =>
    this.receipts().reduce((sum, r) => sum + (r.totals.grandTotal ?? 0), 0),
  );

  readonly periodGrossProfit = computed(() => {
    const products = this.products();
    return this.receipts().reduce((sum, r) => sum + this.profitForReceipt(r, products), 0);
  });

  readonly periodExpenses = computed(() =>
    this.expenses().reduce((sum, e) => sum + e.amount, 0),
  );

  readonly periodNetProfit = computed(() => this.periodGrossProfit() - this.periodExpenses());

  readonly periodPurchasePaid = computed(() =>
    this.purchasePayments().reduce((sum, p) => sum + p.amount, 0),
  );

  readonly supplierCreditOutstanding = computed(() =>
    this.purchases().reduce((sum, p) => sum + Math.max(0, p.remainingAmount), 0),
  );

  readonly totalInventoryValue = computed(() =>
    this.products().reduce((sum, p) => sum + productInventoryValue(p), 0),
  );

  readonly newCustomersInPeriod = computed(() => {
    const range = this.dateRange();
    return this.customers().filter((c) => c.createdAt && isDateInRange(c.createdAt, range)).length;
  });

  readonly totalCustomers = computed(() => this.customers().length);

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
      const key = (r.paymentMethod || 'cash').toLowerCase();
      map.set(key, (map.get(key) ?? 0) + r.totals.grandTotal);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  readonly expiryAlerts = computed(() => {
    const now = new Date();
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

  readonly periodRevenueByDay = computed((): DayPoint[] => {
    const range = this.dateRange();
    const days = eachDayInRange(range);
    return days.map((day) => ({
      label:
        days.length <= 7
          ? day.toLocaleDateString('en-US', { weekday: 'short' })
          : day.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      total: this.sumSalesForDay(day),
    }));
  });

  readonly chartLinePoints = computed(() =>
    this.buildChartPoints(this.periodRevenueByDay(), 560, 200, 24),
  );
  readonly chartAreaPath = computed(() => this.buildAreaPath(this.chartLinePoints()));
  readonly chartPolyline = computed(() => this.chartLinePoints().map((p) => `${p.x},${p.y}`).join(' '));

  readonly recentTransactions = computed(() => this.receipts().slice(0, 8));
  readonly totalReceiptCount = computed(() => this.receipts().length);

  constructor() {
    void this.initStaticData();

    effect((onCleanup) => {
      if (!this.authReady()) return;
      const range = this.dateRange();
      this.bindRangeData(range);
      onCleanup(() => this.unbindRangeData());
    });
  }

  isPresetActive(preset: DateRangePreset): boolean {
    return this.dateRange().preset === preset;
  }

  applyPreset(preset: DateRangePreset): void {
    if (preset === 'custom') {
      const from = parseDateInputValue(this.customFromInput());
      const to = parseDateInputValue(this.customToInput());
      if (from && to) {
        this.dateRange.set(presetRange('custom', from, to));
      } else {
        const today = new Date();
        this.customFromInput.set(toDateInputValue(today));
        this.customToInput.set(toDateInputValue(today));
        this.dateRange.set(presetRange('custom', today, today));
      }
      return;
    }
    this.dateRange.set(presetRange(preset));
    const range = this.dateRange();
    this.customFromInput.set(toDateInputValue(range.start));
    this.customToInput.set(toDateInputValue(range.end));
  }

  onCustomFromChange(value: string): void {
    this.customFromInput.set(value);
  }

  onCustomToChange(value: string): void {
    this.customToInput.set(value);
  }

  applyCustomRange(): void {
    const from = parseDateInputValue(this.customFromInput());
    const to = parseDateInputValue(this.customToInput());
    if (!from || !to) {
      this.error.set('Select valid from and to dates.');
      return;
    }
    this.error.set(null);
    this.dateRange.set(presetRange('custom', from, to));
  }

  private async initStaticData(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
      this.authReady.set(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }

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

    this.purchasesService
      .watchPurchases()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.purchases.set(rows),
        error: () => {},
      });
  }

  private bindRangeData(range: DateRange): void {
    this.unbindRangeData();
    this.loading.set(true);
    const { startMs, endMs } = rangeToMs(range);

    const receiptsSub = this.receiptsService.watchReceiptsInRange(startMs, endMs).subscribe({
      next: (rows) => {
        this.receipts.set(rows);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(mapDataErrorMessage(err));
        this.loading.set(false);
      },
    });

    const expensesSub = this.expensesService.watchExpensesInRange(startMs, endMs).subscribe({
      next: (rows) => this.expenses.set(rows),
      error: () => {},
    });

    const paymentsSub = this.purchasePaymentsService
      .watchPurchasePaymentsInRange(startMs, endMs)
      .subscribe({
        next: (rows) => this.purchasePayments.set(rows),
        error: () => {},
      });

    this.rangeSubs = [receiptsSub, expensesSub, paymentsSub];
  }

  private unbindRangeData(): void {
    for (const sub of this.rangeSubs) sub.unsubscribe();
    this.rangeSubs = [];
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
    return c.mode === 'registered' ? c.fullName || 'Customer' : c.fullName || 'Guest';
  }

  customerWithCredit(r: Receipt): string {
    const name = this.displayCustomer(r.customer);
    if (r.totals.remainingAmount > 0) return `${name} (Udhaar)`;
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

  private profitForReceipt(r: Receipt, products: Product[]): number {
    const stored = r.totals.totalProfit;
    if (stored !== 0 || r.lines.length === 0) return stored;
    return computeReceiptProfitTotals(r.lines, products).totalProfit;
  }

  private sumSalesForDay(day: Date): number {
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameDay(r.createdAt, day))
      .reduce((sum, r) => sum + (r.totals.grandTotal ?? 0), 0);
  }

  private isSameDay(a: Date, b: Date): boolean {
    return startOfDay(a).getTime() === startOfDay(b).getTime();
  }

  private buildChartPoints(data: DayPoint[], width: number, height: number, pad: number): ChartPoint[] {
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
