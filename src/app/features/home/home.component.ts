import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Customer, CustomersService } from '../customers/customers.service';
import { Product, ProductsService } from '../products/products.service';
import {
  ReceiptCustomerMode,
  ReceiptCustomerRef,
  ReceiptDraft,
  ReceiptLineItem,
  ReceiptsService,
} from '../receipts/receipts.service';

type CartLine = {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  quantityStep: number;
  discountPercent: number;
  taxPercent: number;
  unitLabel: string;
};

function generateInvoiceNumber(): string {
  const rnd = Math.floor(Math.random() * 1_000_000);
  return `INV-${Date.now()}-${rnd}`;
}

function lineSubtotal(l: CartLine): number {
  const q = Number.isFinite(l.quantity) ? l.quantity : 0;
  return l.unitPrice * q;
}

function lineTotal(l: CartLine): number {
  const subtotal = lineSubtotal(l);
  const afterDiscount = subtotal - subtotal * (l.discountPercent / 100);
  const tax = afterDiscount * (l.taxPercent / 100);
  return afterDiscount + tax;
}

@Component({
  selector: 'app-home',
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
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
  readonly productSearch = signal('');

  readonly cart = signal<CartLine[]>([]);

  readonly showProductModal = signal(false);
  readonly selectedProduct = signal<Product | null>(null);

  readonly showCheckoutModal = signal(false);
  readonly customerMode = signal<ReceiptCustomerMode>('registered');
  readonly selectedCustomerId = signal<string | null>(null);

  readonly productForm = this.fb.nonNullable.group({
    quantity: [1, [Validators.required, Validators.min(0.0001)]],
    unitPrice: [0, [Validators.required, Validators.min(0)]],
    discountPercent: [0, [Validators.min(0)]],
    taxPercent: [0, [Validators.min(0)]],
  });

  readonly checkoutForm = this.fb.nonNullable.group({
    shopName: ['My Shop', [Validators.required, Validators.maxLength(200)]],
    shopAddress: ['', [Validators.required, Validators.maxLength(1000)]],
    customerSearch: [''],
    guestFullName: [''],
    guestAddress: [''],
    guestPhone: [''],
    guestCnic: [''],
    paidAmount: [0, [Validators.min(0)]],
    paymentMethod: ['cash', [Validators.maxLength(50)]],
  });

  readonly filteredProducts = computed(() => {
    const q = this.productSearch().trim().toLowerCase();
    const all = this.products();
    if (!q) return all;
    return all.filter((p) => p.name.toLowerCase().includes(q));
  });

  readonly filteredCustomers = computed(() => {
    const q = this.checkoutForm.controls.customerSearch.value.trim().toLowerCase();
    const all = this.customers();
    if (!q) return all.slice(0, 8);
    return all
      .filter(
        (c) =>
          (c.fullName || '').toLowerCase().includes(q) ||
          (c.address || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  });

  readonly cartGrandTotal = computed(() =>
    this.cart().reduce((sum, l) => sum + lineTotal(l), 0),
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

    this.productsService
      .watchProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.products.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });

    this.customersService
      .watchCustomers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.customers.set(rows),
        error: (err: unknown) => this.error.set(mapDataErrorMessage(err)),
      });
  }

  productPriceLabel(p: Product): string {
    if (p.type === 'count') {
      const ppc = Math.max(1, p.piecesPerCarton);
      return `${p.pricePerPiece.toFixed(2)} / pc · ${(p.pricePerPiece * ppc).toFixed(2)} / ${p.sellingUnit}`;
    }
    return `${p.pricePerUnit.toFixed(2)} / ${p.sellingUnit}`;
  }

  productStockLabel(p: Product): string {
    if (p.type === 'count') {
      const ppc = Math.max(1, p.piecesPerCarton);
      return `${Math.floor(p.stockInBaseUnit)} pc · ${(p.stockInBaseUnit / ppc).toFixed(1)} ${p.sellingUnit}`;
    }
    const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
    return `${p.stockInBaseUnit.toFixed(0)} ${p.baseUnit} · ${(p.stockInBaseUnit / cf).toFixed(2)} ${p.sellingUnit}`;
  }

  private defaultUnitPrice(p: Product): number {
    if (p.type === 'count') {
      return p.pricePerPiece;
    }
    return p.pricePerUnit;
  }

  defaultQuantityStep(p: Product): number {
    return p.type === 'count' ? 1 : 0.01;
  }

  unitLabel(p: Product): string {
    if (p.type === 'count') return 'pc';
    return p.sellingUnit;
  }

  openProductModal(p: Product): void {
    this.selectedProduct.set(p);
    const step = this.defaultQuantityStep(p);
    this.productForm.reset({
      quantity: step,
      unitPrice: this.defaultUnitPrice(p),
      discountPercent: 0,
      taxPercent: 0,
    });
    this.showProductModal.set(true);
  }

  closeProductModal(): void {
    this.showProductModal.set(false);
    this.selectedProduct.set(null);
  }

  previewLineTotal(): number {
    const v = this.productForm.getRawValue();
    return lineTotal({
      productId: '',
      productName: '',
      unitPrice: v.unitPrice,
      quantity: v.quantity,
      quantityStep: 1,
      discountPercent: v.discountPercent,
      taxPercent: v.taxPercent,
      unitLabel: '',
    });
  }

  confirmAddToCart(): void {
    const p = this.selectedProduct();
    if (!p || this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }
    const v = this.productForm.getRawValue();
    const step = this.defaultQuantityStep(p);
    const existing = this.cart().findIndex((l) => l.productId === p.id);

    const line: CartLine = {
      productId: p.id,
      productName: p.name,
      unitPrice: Math.max(0, v.unitPrice),
      quantity: Math.max(step, v.quantity),
      quantityStep: step,
      discountPercent: Math.max(0, v.discountPercent),
      taxPercent: Math.max(0, v.taxPercent),
      unitLabel: this.unitLabel(p),
    };

    if (existing >= 0) {
      const next = [...this.cart()];
      const cur = next[existing];
      next[existing] = {
        ...cur,
        quantity: cur.quantity + line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxPercent: line.taxPercent,
      };
      this.cart.set(next);
    } else {
      this.cart.set([...this.cart(), line]);
    }

    this.closeProductModal();
  }

  removeFromCart(index: number): void {
    const next = [...this.cart()];
    next.splice(index, 1);
    this.cart.set(next);
  }

  adjustCartQty(index: number, delta: number): void {
    const next = [...this.cart()];
    const l = next[index];
    if (!l) return;
    next[index] = { ...l, quantity: Math.max(l.quantityStep, l.quantity + delta) };
    this.cart.set(next);
  }

  cartLineTotal(index: number): number {
    const l = this.cart()[index];
    return l ? lineTotal(l) : 0;
  }

  openCheckout(): void {
    if (this.cart().length === 0) {
      this.error.set('Cart is empty. Add products first.');
      return;
    }
    this.error.set(null);
    this.checkoutForm.patchValue({
      paidAmount: this.cartGrandTotal(),
    });
    this.showCheckoutModal.set(true);
  }

  closeCheckout(): void {
    this.showCheckoutModal.set(false);
  }

  selectCustomer(id: string): void {
    this.selectedCustomerId.set(id);
    const c = this.customers().find((x) => x.id === id);
    if (c) {
      this.checkoutForm.patchValue({ customerSearch: c.fullName });
    }
  }

  private buildCustomerRef(): ReceiptCustomerRef {
    if (this.customerMode() === 'registered') {
      const id = this.selectedCustomerId();
      const c = this.customers().find((x) => x.id === id);
      if (!c || !id) {
        return { mode: 'guest', fullName: '', address: '', phone: '', cnic: '' };
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
    const v = this.checkoutForm.getRawValue();
    return {
      mode: 'guest',
      fullName: v.guestFullName.trim(),
      address: v.guestAddress.trim(),
      phone: v.guestPhone.trim(),
      cnic: v.guestCnic.trim(),
    };
  }

  async completeCheckout(): Promise<void> {
    if (this.cart().length === 0) return;
    if (this.checkoutForm.controls.shopName.invalid || this.checkoutForm.controls.shopAddress.invalid) {
      this.checkoutForm.markAllAsTouched();
      this.error.set('Shop name and address are required.');
      return;
    }

    const grandTotal = this.cartGrandTotal();
    const paidAmount = Math.max(0, this.checkoutForm.controls.paidAmount.value);
    const remainingAmount = grandTotal - paidAmount;

    const lines: ReceiptLineItem[] = this.cart().map((l) => ({
      productId: l.productId,
      productName: l.productName,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      discountPercent: l.discountPercent,
      taxPercent: l.taxPercent,
    }));

    const draft: ReceiptDraft = {
      shopName: this.checkoutForm.controls.shopName.value,
      shopAddress: this.checkoutForm.controls.shopAddress.value,
      invoiceNumber: generateInvoiceNumber(),
      customer: this.buildCustomerRef(),
      lines,
      totals: { grandTotal, paidAmount, remainingAmount },
      paymentMethod: this.checkoutForm.controls.paymentMethod.value,
    };

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      const id = await this.receiptsService.addReceipt(draft);
      this.cart.set([]);
      this.showCheckoutModal.set(false);
      void this.router.navigateByUrl(`/receipts/${id}`);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
