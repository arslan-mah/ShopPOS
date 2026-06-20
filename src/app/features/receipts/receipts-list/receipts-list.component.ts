import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import QRCode from 'qrcode';
import {
  Receipt,
  ReceiptCustomerRef,
  ReceiptLineItem,
  ReceiptsService,
} from '../receipts.service';
import { AuthService } from '../../../core/auth/auth.service';

function lineTotal(l: ReceiptLineItem): number {
  const subtotal = l.unitPrice * l.quantity;
  const afterDiscount = subtotal - subtotal * (l.discountPercent / 100);
  const tax = afterDiscount * (l.taxPercent / 100);
  return afterDiscount + tax;
}

@Component({
  selector: 'app-receipts-list',
  standalone: true,
  imports: [InputTextModule, CardModule, ButtonModule, MessageModule, DialogModule, DatePipe, DecimalPipe],
  templateUrl: './receipts-list.component.html',
  styleUrl: './receipts-list.component.scss',
})
export class ReceiptsListComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly items = signal<Receipt[]>([]);
  readonly filter = signal('');

  readonly showDetailModal = signal(false);
  readonly selectedReceipt = signal<Receipt | null>(null);
  readonly qrDataUrl = signal<string | null>(null);

  constructor() {
    void this.subscribeWhenAuthReady();

    effect(() => {
      const inv = this.selectedReceipt()?.invoiceNumber;
      if (!inv || !this.showDetailModal()) {
        this.qrDataUrl.set(null);
        return;
      }
      void this.generateQr(inv);
    });
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

  private async generateQr(text: string): Promise<void> {
    try {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 200 });
      this.qrDataUrl.set(dataUrl);
    } catch {
      this.qrDataUrl.set(null);
    }
  }

  displayCustomer(c: ReceiptCustomerRef): string {
    if (c.mode === 'registered') return c.fullName || '—';
    return c.fullName || 'Guest';
  }

  filteredItems(): Receipt[] {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((r) => {
      const cust = this.displayCustomer(r.customer).toLowerCase();
      const addr = (r.customer.address || '').toLowerCase();
      return r.invoiceNumber.toLowerCase().includes(q) || cust.includes(q) || addr.includes(q);
    });
  }

  openReceipt(r: Receipt): void {
    this.selectedReceipt.set(r);
    this.showDetailModal.set(true);
  }

  closeDetail(): void {
    this.showDetailModal.set(false);
    this.selectedReceipt.set(null);
  }

  receiptLineTotal(l: ReceiptLineItem): number {
    return lineTotal(l);
  }
}
