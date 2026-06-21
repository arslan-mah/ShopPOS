import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Product, ProductsService } from '../products/products.service';
import { Supplier, SuppliersService } from '../suppliers/suppliers.service';
import { Purchase, PurchaseDraft, PurchaseLine, PurchasePaymentMode, PurchasesService } from './purchases.service';
import { PurchasePaymentsService } from './purchase-payments.service';
import { BarcodeScanToolbarComponent } from '../../shared/barcode/barcode-scan-toolbar.component';
import { findProductByBarcode } from '../../shared/barcode/barcode.util';

interface DraftLine {
  key: string;
  productId: string;
  quantity: number;
  unitLabel: string;
  unitCost: number;
}

@Component({
  selector: 'app-purchases',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TagModule,
    BarcodeScanToolbarComponent,
  ],
  templateUrl: './purchases.component.html',
  styleUrl: './purchases.component.scss',
})
export class PurchasesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly purchasesService = inject(PurchasesService);
  private readonly purchasePaymentsService = inject(PurchasePaymentsService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly productsService = inject(ProductsService);

  readonly purchases = signal<Purchase[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  showPurchaseModal = false;
  showPayModal = false;
  readonly editingPurchase = signal<Purchase | null>(null);
  readonly payingPurchase = signal<Purchase | null>(null);
  readonly draftLines = signal<DraftLine[]>([]);
  readonly paymentMode = signal<PurchasePaymentMode>('net');
  readonly partialPaidAmount = signal(0);

  readonly form = this.fb.nonNullable.group({
    supplierId: ['', Validators.required],
    invoiceNumber: ['', [Validators.required, Validators.maxLength(100)]],
    paidAmount: [0, [Validators.min(0)]],
    paymentMethod: ['cash', [Validators.maxLength(50)]],
  });

  readonly draftTotal = computed(() =>
    this.draftLines().reduce((sum, l) => sum + l.quantity * l.unitCost, 0),
  );

  readonly draftPaidAmount = computed(() => {
    const total = this.draftTotal();
    const mode = this.paymentMode();
    if (mode === 'net') return total;
    if (mode === 'credit') return 0;
    return Math.min(total, Math.max(0, this.partialPaidAmount()));
  });

  readonly draftRemainingAmount = computed(() =>
    Math.max(0, this.draftTotal() - this.draftPaidAmount()),
  );

  readonly isEditMode = computed(() => this.editingPurchase() !== null);

  readonly totalSupplierCredit = computed(() =>
    this.purchases().reduce((sum, p) => sum + Math.max(0, p.remainingAmount), 0),
  );

  readonly payForm = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    paymentMethod: ['cash', [Validators.maxLength(50)]],
  });

  ngOnInit(): void {
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

    this.purchasesService
      .watchPurchases()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.purchases.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });

    this.suppliersService
      .watchSuppliers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (rows) => this.suppliers.set(rows) });

    this.productsService
      .watchProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (rows) => this.products.set(rows) });
  }

  openAdd(): void {
    this.editingPurchase.set(null);
    this.form.reset({ supplierId: '', invoiceNumber: '', paidAmount: 0, paymentMethod: 'cash' });
    this.paymentMode.set('net');
    this.partialPaidAmount.set(0);
    this.draftLines.set([this.emptyLine()]);
    this.showPurchaseModal = true;
  }

  openEdit(p: Purchase): void {
    this.editingPurchase.set(p);
    this.form.patchValue({
      supplierId: p.supplierId,
      invoiceNumber: p.invoiceNumber,
      paidAmount: p.paidAmount,
      paymentMethod: p.paymentMethod || 'cash',
    });
    this.draftLines.set(
      p.lines.map((l) => ({
        key: this.newLineKey(),
        productId: l.productId,
        quantity: l.quantity,
        unitLabel: l.unitLabel,
        unitCost: l.unitCost,
      })),
    );
    if (p.remainingAmount <= 0) {
      this.paymentMode.set('net');
      this.partialPaidAmount.set(p.total);
    } else if (p.paidAmount <= 0) {
      this.paymentMode.set('credit');
      this.partialPaidAmount.set(0);
    } else {
      this.paymentMode.set('partial');
      this.partialPaidAmount.set(p.paidAmount);
    }
    this.showPurchaseModal = true;
  }

  openPaySupplier(p: Purchase): void {
    this.payingPurchase.set(p);
    this.payForm.reset({ amount: p.remainingAmount, paymentMethod: 'cash' });
    this.showPayModal = true;
  }

  closePurchaseModal(): void {
    this.showPurchaseModal = false;
    this.editingPurchase.set(null);
  }

  closePayModal(): void {
    this.showPayModal = false;
    this.payingPurchase.set(null);
  }

  setPaymentMode(mode: PurchasePaymentMode): void {
    this.paymentMode.set(mode);
    const total = this.draftTotal();
    if (mode === 'net') {
      this.partialPaidAmount.set(total);
      this.form.patchValue({ paidAmount: total });
    } else if (mode === 'credit') {
      this.partialPaidAmount.set(0);
      this.form.patchValue({ paidAmount: 0 });
    } else {
      const paid = this.partialPaidAmount();
      if (paid <= 0 || paid >= total) {
        this.partialPaidAmount.set(0);
        this.form.patchValue({ paidAmount: 0 });
      }
    }
  }

  onPaidAmountInput(value: string): void {
    const parsed = Number(value);
    const paid = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    this.partialPaidAmount.set(paid);
    this.form.patchValue({ paidAmount: paid });
    if (this.paymentMode() !== 'partial') {
      this.paymentMode.set('partial');
    }
  }

  purchasePaymentLabel(p: Purchase): string {
    if (p.remainingAmount <= 0) return 'Paid';
    if (p.paidAmount <= 0) return 'Credit';
    return 'Partial';
  }

  purchasePaymentSeverity(p: Purchase): 'success' | 'warn' | 'danger' {
    if (p.remainingAmount <= 0) return 'success';
    if (p.paidAmount <= 0) return 'danger';
    return 'warn';
  }

  onAddClosed(): void {
    this.closePurchaseModal();
  }

  emptyLine(): DraftLine {
    return { key: this.newLineKey(), productId: '', quantity: 1, unitLabel: '', unitCost: 0 };
  }

  private newLineKey(): string {
    return `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  addLine(): void {
    this.draftLines.update((lines) => [...lines, this.emptyLine()]);
    this.syncPaidAmountForMode();
  }

  removeLine(index: number): void {
    this.draftLines.update((lines) => lines.filter((_, i) => i !== index));
    this.syncPaidAmountForMode();
  }

  updateLine(index: number, patch: Partial<Omit<DraftLine, 'key'>>): void {
    this.draftLines.update((lines) =>
      lines.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const p = this.products().find((x) => x.id === patch.productId);
          if (p) {
            next.unitLabel = this.defaultUnitLabel(p);
            next.unitCost = p.cost > 0 ? p.cost : 0;
          }
        }
        return next;
      }),
    );
    this.syncPaidAmountForMode();
  }

  private syncPaidAmountForMode(): void {
    if (this.paymentMode() === 'net') {
      const total = this.draftTotal();
      this.partialPaidAmount.set(total);
      this.form.patchValue({ paidAmount: total }, { emitEvent: false });
    }
  }

  unitOptions(productId: string): { value: string; label: string }[] {
    const p = this.products().find((x) => x.id === productId);
    if (!p) return [];
    const raw =
      p.type === 'count'
        ? [
            { value: 'pc', label: 'Pieces' },
            { value: p.sellingUnit, label: p.sellingUnit },
            { value: 'carton', label: 'Carton' },
          ]
        : [
            { value: p.baseUnit, label: p.baseUnit },
            { value: p.sellingUnit, label: p.sellingUnit },
          ];
    const seen = new Set<string>();
    return raw.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }

  defaultUnitLabel(p: Product): string {
    if (p.type === 'count') return 'pc';
    return p.sellingUnit;
  }

  productName(id: string): string {
    return this.products().find((p) => p.id === id)?.name ?? '—';
  }

  addLineFromBarcode(code: string): void {
    const product = findProductByBarcode(this.products(), code);
    if (!product) {
      this.error.set(`No product found for barcode "${code}".`);
      return;
    }

    const lines = this.draftLines();
    const existingIdx = lines.findIndex((l) => l.productId === product.id);
    if (existingIdx >= 0) {
      this.updateLine(existingIdx, { quantity: lines[existingIdx].quantity + 1 });
      this.error.set(null);
      return;
    }

    const emptyIdx = lines.findIndex((l) => !l.productId);
    if (emptyIdx >= 0) {
      this.updateLine(emptyIdx, { productId: product.id });
    } else {
      this.draftLines.update((rows) => [
        ...rows,
        {
          key: this.newLineKey(),
          productId: product.id,
          quantity: 1,
          unitLabel: this.defaultUnitLabel(product),
          unitCost: product.cost > 0 ? product.cost : 0,
        },
      ]);
      this.syncPaidAmountForMode();
    }
    this.error.set(null);
  }

  onPurchaseBarcodeScanned(code: string): void {
    if (!this.showPurchaseModal) return;
    this.addLineFromBarcode(code);
  }

  async savePurchase(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const lines = this.draftLines().filter((l) => l.productId && l.quantity > 0);
    if (lines.length === 0) {
      this.error.set('Add at least one product line.');
      return;
    }

    const { supplierId, invoiceNumber, paymentMethod } = this.form.getRawValue();
    const supplier = this.suppliers().find((s) => s.id === supplierId);
    const purchaseLines: PurchaseLine[] = lines.map((l) => ({
      productId: l.productId,
      productName: this.productName(l.productId),
      quantity: l.quantity,
      unitLabel: l.unitLabel,
      unitCost: l.unitCost,
      lineTotal: l.quantity * l.unitCost,
    }));

    const total = purchaseLines.reduce((s, l) => s + l.lineTotal, 0);
    const paidAmount = this.draftPaidAmount();
    const remainingAmount = Math.max(0, total - paidAmount);

    if (this.paymentMode() === 'partial' && paidAmount <= 0) {
      this.error.set('Enter the amount paid now, or choose Full credit.');
      return;
    }
    if (paidAmount > total) {
      this.error.set('Paid amount cannot exceed purchase total.');
      return;
    }

    const draft: PurchaseDraft = {
      supplierId,
      supplierName: supplier?.name,
      invoiceNumber,
      lines: purchaseLines,
      total,
      paidAmount,
      remainingAmount,
      paymentMethod,
    };

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      const editing = this.editingPurchase();
      if (editing) {
        await this.purchasesService.updatePurchase(editing.id, draft, this.products(), editing);
      } else {
        await this.purchasesService.addPurchase(draft, this.products());
      }
      this.closePurchaseModal();
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async submitSupplierPayment(): Promise<void> {
    const p = this.payingPurchase();
    if (!p || this.payForm.invalid) {
      this.payForm.markAllAsTouched();
      return;
    }
    const { amount, paymentMethod } = this.payForm.getRawValue();

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.purchasePaymentsService.paySupplier(p.id, p.supplierId, amount, paymentMethod);
      this.closePayModal();
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
