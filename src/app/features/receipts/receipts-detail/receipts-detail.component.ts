import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import QRCode from 'qrcode';
import { ReceiptsService, ReceiptCustomerRef, Receipt, ReceiptLineItem } from '../receipts.service';
import { AuthService } from '../../../core/auth/auth.service';

function lineSubtotal(l: ReceiptLineItem): number {
  const q = Number.isFinite(l.quantity) ? l.quantity : 0;
  return l.unitPrice * q;
}

function lineTotals(l: ReceiptLineItem): { lineTotal: number } {
  const subtotal = lineSubtotal(l);
  const discountAmount = subtotal * (l.discountPercent / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (l.taxPercent / 100);
  const lineTotal = afterDiscount + taxAmount;
  return { lineTotal };
}

@Component({
  selector: 'app-receipts-detail',
  standalone: true,
  imports: [CardModule, ButtonModule, MessageModule, DatePipe, DecimalPipe],
  templateUrl: './receipts-detail.component.html',
  styleUrl: './receipts-detail.component.scss',
})
export class ReceiptsDetailComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly receiptId = signal<string | null>(null);
  readonly receipts = signal<Receipt[]>([]);

  readonly qrDataUrl = signal<string | null>(null);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((pm) => {
      this.receiptId.set(pm.get('id'));
      // Reset QR so it regenerates for the new invoice.
      this.qrDataUrl.set(null);
    });

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
          this.error.set(err instanceof Error ? err.message : 'Failed to load receipts.');
          this.loading.set(false);
        },
      });
  }

  get receipt(): Receipt | null {
    const id = this.receiptId();
    if (!id) return null;
    return this.receipts().find((r) => r.id === id) ?? null;
  }

  ngDoCheck(): void {
    // Lightweight guard to avoid unnecessary QR generations.
    const inv = this.receipt?.invoiceNumber;
    if (!inv) return;
    // If qrDataUrl is already set, do not regenerate on every change detection.
    if (this.qrDataUrl()) return;
    void this.generateQr(inv);
  }

  private async generateQr(text: string): Promise<void> {
    try {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
      this.qrDataUrl.set(dataUrl);
    } catch {
      this.qrDataUrl.set(null);
    }
  }

  backToCreate(): void {
    void this.router.navigateByUrl('/receipts');
  }

  backToList(): void {
    void this.router.navigateByUrl('/receipts/list');
  }

  displayCustomer(c: ReceiptCustomerRef): string {
    return c.mode === 'registered' ? c.fullName || '—' : c.fullName || 'Guest';
  }

  receiptLineTotal(l: ReceiptLineItem): number {
    return lineTotals(l).lineTotal;
  }
}

