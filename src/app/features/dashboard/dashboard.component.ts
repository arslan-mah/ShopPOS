import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Customer, CustomersService } from '../customers/customers.service';
import { Product, ProductsService } from '../products/products.service';
import { Receipt, ReceiptCustomerRef, ReceiptsService } from '../receipts/receipts.service';

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

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly receipts = signal<Receipt[]>([]);
  readonly products = signal<Product[]>([]);
  readonly customers = signal<Customer[]>([]);

  /** Placeholder until expense tracking is implemented. */
  readonly expensesDisplay = 'Rs. 42,500';
  readonly profitDisplay = 'Rs. 180k';

  readonly todaySales = computed(() => this.sumSalesForDay(new Date()));
  readonly monthlySales = computed(() => this.sumSalesForMonth(new Date()));
  readonly totalCustomers = computed(() => this.customers().length);
  readonly newCustomersThisMonth = computed(() => {
    const now = new Date();
    return this.customers().filter((c) => c.createdAt && this.isSameMonth(c.createdAt, now)).length;
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

  private sumSalesForDay(day: Date): number {
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameDay(r.createdAt, day))
      .reduce((sum, r) => sum + r.totals.grandTotal, 0);
  }

  private sumSalesForMonth(day: Date): number {
    return this.receipts()
      .filter((r) => r.createdAt && this.isSameMonth(r.createdAt, day))
      .reduce((sum, r) => sum + r.totals.grandTotal, 0);
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
