import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { ProductsService, Product } from '../products/products.service';
import { CustomersService, Customer } from '../customers/customers.service';
import {
  ReceiptCustomerRef,
  ReceiptCustomerMode,
  ReceiptDraft,
  ReceiptLineItem,
  ReceiptTotals,
  ReceiptsService,
} from './receipts.service';
import QRCode from 'qrcode';
import { Router } from '@angular/router';

type ReceiptLineDraft = {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  quantityStep: number;
  discountPercent: number;
  taxPercent: number;
};

function generateInvoiceNumber(): string {
  // Must be unique enough for RTDB usage; RTDB `push()` key is also unique on save.
  const rnd = Math.floor(Math.random() * 1_000_000);
  return `INV-${Date.now()}-${rnd}`;
}

function lineSubtotal(l: ReceiptLineDraft): number {
  const q = Number.isFinite(l.quantity) ? l.quantity : 0;
  return l.unitPrice * q;
}

function lineTotals(l: ReceiptLineDraft): { lineTotal: number; afterDiscount: number; taxAmount: number } {
  const subtotal = lineSubtotal(l);
  const discountAmount = subtotal * (l.discountPercent / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (l.taxPercent / 100);
  const lineTotal = afterDiscount + taxAmount;
  return { lineTotal, afterDiscount, taxAmount };
}

@Component({
  selector: 'app-receipts',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe, DecimalPipe, CardModule, ButtonModule, MessageModule, InputTextModule, TagModule],
  templateUrl: './receipts.component.html',
  styleUrl: './receipts.component.scss',
})
export class ReceiptsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly productsService = inject(ProductsService);
  private readonly customersService = inject(CustomersService);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly products = signal<Product[]>([]);
  readonly customers = signal<Customer[]>([]);

  readonly invoiceNumber = signal(generateInvoiceNumber());
  readonly qrDataUrl = signal<string | null>(null);

  readonly customerMode = signal<ReceiptCustomerMode>('registered');
  readonly selectedCustomerId = signal<string | null>(null);

  readonly lines = signal<ReceiptLineDraft[]>([]);

  readonly showSavedPreview = signal(false);
  readonly savedReceiptId = signal<string | null>(null);
  readonly savedShopName = signal<string | null>(null);
  readonly savedShopAddress = signal<string | null>(null);
  readonly savedCustomer = signal<ReceiptCustomerRef | null>(null);
  readonly savedTotals = signal<ReceiptTotals | null>(null);
  readonly savedPaymentMethod = signal<string | null>(null);
  readonly savedCreatedAt = signal<Date | null>(null);

  readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.maxLength(200)]],
    shopAddress: ['', [Validators.required, Validators.maxLength(1000)]],

    productSearch: [''],
    customerSearch: [''],

    guestFullName: [''],
    guestAddress: [''],
    guestPhone: [''],
    guestCnic: [''],

    paidAmount: [0, [Validators.min(0)]],
    paymentMethod: ['cash', [Validators.maxLength(50)]],
  });

  readonly filteredProducts = computed(() => {
    const q = this.form.controls.productSearch.value.trim().toLowerCase();
    const all = this.products();
    if (!q) return all.slice(0, 8);
    return all
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  readonly filteredCustomers = computed(() => {
    const q = this.form.controls.customerSearch.value.trim().toLowerCase();
    const all = this.customers();
    if (!q) return all.slice(0, 8);
    return all
      .filter((c) => (c.fullName || '').toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q))
      .slice(0, 8);
  });

  readonly totals = computed(() => {
    const list = this.lines();
    const grandTotal = list.reduce((sum, l) => sum + lineTotals(l).lineTotal, 0);
    const paidAmount = this.safePaidAmount();
    const remainingAmount = grandTotal - paidAmount;
    return { grandTotal, paidAmount, remainingAmount };
  });

  constructor() {
    void this.subscribeWhenAuthReady();
    void this.generateQr();
    this.form.controls.shopName.setValue('My Shop');
  }

  private async subscribeWhenAuthReady(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
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
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });

    this.customersService
      .watchCustomers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.customers.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  private safePaidAmount(): number {
    const v = this.form.controls.paidAmount.value;
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  private async generateQr(): Promise<void> {
    const text = this.invoiceNumber();
    if (!text) {
      this.qrDataUrl.set(null);
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
      this.qrDataUrl.set(dataUrl);
    } catch {
      this.qrDataUrl.set(null);
    }
  }

  newReceipt(): void {
    this.lines.set([]);
    this.selectedCustomerId.set(null);
    this.customerMode.set('registered');
    this.form.patchValue({
      guestFullName: '',
      guestAddress: '',
      guestPhone: '',
      guestCnic: '',
      paidAmount: 0,
      paymentMethod: 'cash',
    });
    this.savedReceiptId.set(null);
    this.showSavedPreview.set(false);
    this.savedShopName.set(null);
    this.savedShopAddress.set(null);
    this.savedCustomer.set(null);
    this.savedTotals.set(null);
    this.savedPaymentMethod.set(null);
    this.savedCreatedAt.set(null);
    this.invoiceNumber.set(generateInvoiceNumber());
    void this.generateQr();
  }

  goToList(): void {
    void this.router.navigateByUrl('/receipts/list');
  }

  goToCreate(): void {
    void this.router.navigateByUrl('/receipts');
  }

  private productUnitPriceInSellingUnit(p: Product): number {
    // In your Products model:
    // - count: sellingUnit is cartons and pricePerPiece is per single piece
    // - weight/volume: sellingUnit matches pricePerUnit
    if (p.type === 'count') {
      return p.pricePerPiece * Math.max(1, p.piecesPerCarton || 1);
    }
    return p.pricePerUnit;
  }

  addProduct(p: Product): void {
    const existingIndex = this.lines().findIndex((l) => l.productId === p.id);
    const unitPrice = this.productUnitPriceInSellingUnit(p);

    const quantityStep = p.type === 'count' ? 1 : 0.01;

    if (existingIndex >= 0) {
      const next = [...this.lines()];
      const cur = next[existingIndex];
      next[existingIndex] = { ...cur, quantity: Math.max(0, cur.quantity + quantityStep) };
      this.lines.set(next);
      return;
    }

    this.lines.set([
      ...this.lines(),
      {
        productId: p.id,
        productName: p.name,
        unitPrice: unitPrice >= 0 ? unitPrice : 0,
        quantity: quantityStep,
        quantityStep,
        discountPercent: 0,
        taxPercent: 0,
      },
    ]);
  }

  removeLine(index: number): void {
    const next = [...this.lines()];
    next.splice(index, 1);
    this.lines.set(next);
  }

  adjustQuantity(index: number, delta: number): void {
    const next = [...this.lines()];
    const l = next[index];
    if (!l) return;
    const q = l.quantity + delta;
    next[index] = { ...l, quantity: Math.max(0, q) };
    this.lines.set(next);
  }

  setQuantity(index: number, raw: unknown): void {
    const v = typeof raw === 'number' ? raw : Number(raw);
    const q = Number.isFinite(v) ? Math.max(0, v) : 0;
    const next = [...this.lines()];
    next[index] = { ...next[index], quantity: q };
    this.lines.set(next);
  }

  updateLine(index: number, patch: Partial<ReceiptLineDraft>): void {
    const next = [...this.lines()];
    const cur = next[index];
    if (!cur) return;
    next[index] = { ...cur, ...patch };
    this.lines.set(next);
  }

  private buildCustomerRef(): ReceiptCustomerRef {
    if (this.customerMode() === 'registered') {
      const id = this.selectedCustomerId();
      const c = this.customers().find((x) => x.id === id);
      if (!c || !id) {
        // Fallback to guest when nothing is selected.
        return {
          mode: 'guest',
          fullName: '',
          address: '',
          phone: '',
          cnic: '',
        };
      }
      return {
        mode: 'registered',
        customerId: id,
        fullName: c.fullName || '',
        address: c.address || '',
        phone: c.phone || '',
        cnic: c.cnic || '',
      };
    }
    return {
      mode: 'guest',
      fullName: (this.form.controls.guestFullName.value || '').trim(),
      address: (this.form.controls.guestAddress.value || '').trim(),
      phone: (this.form.controls.guestPhone.value || '').trim(),
      cnic: (this.form.controls.guestCnic.value || '').trim(),
    };
  }

  async saveReceipt(): Promise<void> {
    this.error.set(null);
    this.showSavedPreview.set(false);

    if (this.lines().length === 0) {
      this.error.set('Add at least one product line.');
      return;
    }
    if (this.form.controls.shopName.invalid || this.form.controls.shopAddress.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Shop name and address are required.');
      return;
    }

    const customer = this.buildCustomerRef();

    const lines: ReceiptLineItem[] = this.lines().map((l) => ({
      productId: l.productId,
      productName: l.productName,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      discountPercent: Math.max(0, l.discountPercent),
      taxPercent: Math.max(0, l.taxPercent),
    }));

    const { grandTotal, paidAmount, remainingAmount } = this.totals();

    if (!Number.isFinite(grandTotal) || grandTotal < 0) {
      this.error.set('Invalid totals.');
      return;
    }

    if (paidAmount > grandTotal) {
      // Allow over-payment but keep remaining negative.
      // If you prefer clamping, we can change this behavior.
    }

    const draft: ReceiptDraft = {
      shopName: this.form.controls.shopName.value,
      shopAddress: this.form.controls.shopAddress.value,
      invoiceNumber: this.invoiceNumber(),
      customer,
      lines,
      totals: {
        grandTotal,
        paidAmount,
        remainingAmount,
      },
      paymentMethod: this.form.controls.paymentMethod.value,
    };

    this.saving.set(true);
    try {
      const now = new Date();
      this.savedShopName.set(draft.shopName);
      this.savedShopAddress.set(draft.shopAddress);
      this.savedCustomer.set(draft.customer);
      this.savedTotals.set(draft.totals);
      this.savedPaymentMethod.set(draft.paymentMethod);
      this.savedCreatedAt.set(now);

      await this.auth.ensureSessionForDatabase();
      const id = await this.receiptsService.addReceipt(draft);
      this.savedReceiptId.set(id);
      this.showSavedPreview.set(true);
      this.qrDataUrl.set(await QRCode.toDataURL(this.invoiceNumber(), { errorCorrectionLevel: 'M', margin: 1, width: 256 }));
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  // UI helpers
  lineTotalFor(index: number): number {
    const l = this.lines()[index];
    if (!l) return 0;
    return lineTotals(l).lineTotal;
  }

  lineSubtotalFor(index: number): number {
    const l = this.lines()[index];
    if (!l) return 0;
    return lineSubtotal(l);
  }
}

