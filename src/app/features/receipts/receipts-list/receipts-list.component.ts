import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { ReceiptsService, ReceiptCustomerRef, Receipt } from '../receipts.service';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-receipts-list',
  standalone: true,
  imports: [InputTextModule, CardModule, ButtonModule, MessageModule, DatePipe, DecimalPipe],
  templateUrl: './receipts-list.component.html',
  styleUrl: './receipts-list.component.scss',
})
export class ReceiptsListComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly items = signal<Receipt[]>([]);

  readonly filter = signal('');

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
          this.items.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(err instanceof Error ? err.message : 'Failed to load receipts.');
          this.loading.set(false);
        },
      });
  }

  displayCustomer(c: ReceiptCustomerRef): string {
    if (c.mode === 'registered') return c.fullName || '—';
    return c.fullName || 'Guest';
  }

  customerSub(c: ReceiptCustomerRef): string {
    if (c.mode === 'registered') return c.address || '';
    return c.address || '';
  }

  customerChipValue(inv: Receipt): string {
    return this.displayCustomer(inv.customer);
  }

  filteredItems(): Receipt[] {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((r) => {
      const cust = this.displayCustomer(r.customer).toLowerCase();
      const addr = this.customerSub(r.customer).toLowerCase();
      return r.invoiceNumber.toLowerCase().includes(q) || cust.includes(q) || addr.includes(q);
    });
  }

  goCreate(): void {
    void this.router.navigateByUrl('/receipts');
  }

  openReceipt(r: Receipt): void {
    void this.router.navigateByUrl(`/receipts/${r.id}`);
  }
}

