import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import QRCode from 'qrcode';
import { BarcodeScanToolbarComponent } from '../../../shared/barcode/barcode-scan-toolbar.component';
import { findReceiptByScanCode } from '../../../shared/barcode/barcode.util';
import { AuthService } from '../../../core/auth/auth.service';
import { PermissionsService } from '../../../core/auth/permissions.service';
import { mapDataErrorMessage } from '../../../core/firebase/map-data-error-message';
import { Product, ProductsService } from '../../products/products.service';
import {
  Receipt,
  ReceiptCustomerRef,
  ReceiptLineItem,
  RefundableLineState,
  ReceiptsService,
  buildRefundableLines,
  hasRefundableQuantity,
  receiptLineTotal,
} from '../receipts.service';
import { computeReceiptProfitTotals } from '../receipt-math';

const PAGE_SIZE = 50;

@Component({
  selector: 'app-receipts-list',
  standalone: true,
  imports: [
    InputTextModule,
    CardModule,
    ButtonModule,
    MessageModule,
    DialogModule,
    TagModule,
    DatePipe,
    DecimalPipe,
    BarcodeScanToolbarComponent,
  ],
  templateUrl: './receipts-list.component.html',
  styleUrl: './receipts-list.component.scss',
})
export class ReceiptsListComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly productsService = inject(ProductsService);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);

  readonly pageSize = PAGE_SIZE;
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(true);
  readonly error = signal<string | null>(null);
  readonly items = signal<Receipt[]>([]);
  readonly products = signal<Product[]>([]);
  readonly filter = signal('');
  /** Refund receipts loaded for the receipt being refunded. */
  private readonly refundContextReceipts = signal<Receipt[]>([]);

  readonly showDetailModal = signal(false);
  readonly selectedReceipt = signal<Receipt | null>(null);
  readonly qrDataUrl = signal<string | null>(null);

  readonly showRefundModal = signal(false);
  readonly refundLines = signal<RefundableLineState[]>([]);
  readonly refunding = signal(false);

  readonly canRefundSelected = computed(() => {
    if (!this.permissions.isAdmin()) return false;
    const r = this.selectedReceipt();
    if (!r || r.type === 'refund') return false;
    return hasRefundableQuantity(r, this.refundContextReceipts());
  });

  readonly receiptScanEnabled = computed(
    () => !this.showDetailModal() && !this.showRefundModal() && !this.refunding(),
  );

  readonly filteredItems = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const rows = this.items();
    if (!q) return rows;
    return rows.filter((r) => {
      const cust = this.displayCustomer(r.customer).toLowerCase();
      const addr = (r.customer.address || '').toLowerCase();
      return (
        r.invoiceNumber.toLowerCase().includes(q) ||
        cust.includes(q) ||
        addr.includes(q) ||
        (r.originalInvoiceNumber || '').toLowerCase().includes(q)
      );
    });
  });

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
      .watchRecentReceipts(PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.items.set(rows);
          this.hasMore.set(rows.length >= PAGE_SIZE);
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
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    const rows = this.items();
    const oldest = rows[rows.length - 1]?.createdAt;
    if (!oldest) {
      this.hasMore.set(false);
      return;
    }

    this.loadingMore.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      const older = await this.receiptsService.loadOlderReceipts(oldest.getTime(), PAGE_SIZE);
      const existingIds = new Set(rows.map((r) => r.id));
      const merged = [...rows];
      for (const r of older) {
        if (!existingIds.has(r.id)) merged.push(r);
      }
      merged.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      this.items.set(merged);
      this.hasMore.set(older.length >= PAGE_SIZE);
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    } finally {
      this.loadingMore.set(false);
    }
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

  receiptTypeLabel(r: Receipt): string {
    return r.type === 'refund' ? 'Refund' : 'Sale';
  }

  openReceipt(r: Receipt): void {
    this.selectedReceipt.set(r);
    this.showDetailModal.set(true);
  }

  onReceiptBarcodeScanned(code: string): void {
    const receipt = findReceiptByScanCode(this.items(), code);
    if (!receipt) {
      this.error.set(`No receipt found in loaded list for "${code}". Load more if it is older.`);
      return;
    }
    this.error.set(null);
    this.openReceipt(receipt);
  }

  closeDetail(): void {
    this.showDetailModal.set(false);
    this.selectedReceipt.set(null);
    this.refundContextReceipts.set([]);
  }

  printDetail(): void {
    window.print();
  }

  async openOriginalReceipt(originalId: string | undefined): Promise<void> {
    if (!originalId) return;
    const local = this.items().find((r) => r.id === originalId);
    if (local) {
      this.openReceipt(local);
      return;
    }
    try {
      await this.auth.ensureSessionForDatabase();
      const fetched = await this.receiptsService.getReceiptById(originalId);
      if (fetched) this.openReceipt(fetched);
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    }
  }

  receiptLineTotal(l: ReceiptLineItem): number {
    return receiptLineTotal(l);
  }

  async openRefundModal(): Promise<void> {
    const r = this.selectedReceipt();
    if (!r || r.type === 'refund') return;
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      const refunds = await this.receiptsService.getRefundsForOriginal(r.id);
      this.refundContextReceipts.set(refunds);
      this.refundLines.set(buildRefundableLines(r, refunds));
      this.showRefundModal.set(true);
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    }
  }

  closeRefundModal(): void {
    this.showRefundModal.set(false);
    this.refundLines.set([]);
  }

  refundQtyStep(line: RefundableLineState): number {
    const label = (line.line.unitLabel || '').toLowerCase();
    return label === 'pc' || label === 'piece' || label === 'pieces' ? 1 : 0.01;
  }

  toggleRefundLine(index: number): void {
    const next = [...this.refundLines()];
    const row = next[index];
    if (!row || row.refundableQty <= 0) return;

    if (row.selected) {
      next[index] = { ...row, selected: false, refundQty: 0 };
    } else {
      const step = this.refundQtyStep(row);
      next[index] = {
        ...row,
        selected: true,
        refundQty: Math.min(row.refundableQty, step >= 1 ? 1 : row.refundableQty),
      };
    }
    this.refundLines.set(next);
  }

  adjustRefundQty(index: number, delta: number): void {
    const row = this.refundLines()[index];
    if (!row) return;
    this.setRefundQty(index, row.refundQty + delta);
  }

  onRefundQtyInput(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '' || raw === '-') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    this.setRefundQty(index, parsed);
  }

  onRefundQtyBlur(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    if (raw === '' || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
      this.setRefundQty(index, 0);
      input.value = '0';
    } else {
      const row = this.refundLines()[index];
      if (row) input.value = String(row.refundQty);
    }
  }

  onRefundQtyFocus(event: FocusEvent): void {
    const el = event.target as HTMLInputElement;
    requestAnimationFrame(() => el.select());
  }

  private setRefundQty(index: number, qty: number): void {
    const next = [...this.refundLines()];
    const row = next[index];
    if (!row || row.refundableQty <= 0) return;

    const step = this.refundQtyStep(row);
    const rounded = step >= 1 ? Math.round(qty) : Math.round(qty / step) * step;
    const clamped = Math.min(row.refundableQty, Math.max(0, rounded));

    if (clamped <= 0) {
      next[index] = { ...row, selected: false, refundQty: 0 };
    } else {
      next[index] = { ...row, selected: true, refundQty: clamped };
    }
    this.refundLines.set(next);
  }

  refundLinePreviewTotal(row: RefundableLineState): number {
    if (!row.selected || row.refundQty <= 0) return 0;
    return receiptLineTotal({
      ...row.line,
      quantity: -row.refundQty,
    });
  }

  refundPreviewGrandTotal(): number {
    return this.refundLines().reduce((sum, row) => sum + this.refundLinePreviewTotal(row), 0);
  }

  hasRefundSelection(): boolean {
    return this.refundLines().some((l) => l.selected && l.refundQty > 0);
  }

  async confirmRefund(): Promise<void> {
    const original = this.selectedReceipt();
    if (!original || !this.hasRefundSelection()) return;

    this.refunding.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      const lines = this.refundLines();
      const refundLinesPayload = lines
        .filter((l) => l.selected && l.refundQty > 0)
        .map((l) => ({
          ...l.line,
          quantity: -l.refundQty,
          originalLineIndex: l.lineIndex,
        }));
      const profitTotals = computeReceiptProfitTotals(refundLinesPayload, this.products());
      const refundId = await this.receiptsService.addRefundReceipt(original, lines, profitTotals);

      await this.productsService.restoreStockForReceiptLines(refundLinesPayload, this.products(), refundId);

      this.closeRefundModal();

      await new Promise((resolve) => setTimeout(resolve, 400));
      const created = this.items().find((r) => r.id === refundId);
      if (created) {
        this.openReceipt(created);
      } else {
        const fetched = await this.receiptsService.getReceiptById(refundId);
        if (fetched) this.openReceipt(fetched);
      }
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.refunding.set(false);
    }
  }
}
