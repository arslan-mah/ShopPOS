import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { CreditPaymentsService } from '../credit/credit-payments.service';
import { Receipt, ReceiptLineItem, ReceiptsService, receiptLineTotal } from '../receipts/receipts.service';
import { Customer, CustomersService } from './customers.service';
import { customerOutstandingCredit, customerReceipts } from './customer-credit.util';

@Component({
  selector: 'app-customer-detail',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss',
})
export class CustomerDetailComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly customersService = inject(CustomersService);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly creditPaymentsService = inject(CreditPaymentsService);

  readonly customerId = signal('');
  readonly customer = signal<Customer | null>(null);
  readonly receipts = signal<Receipt[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly showReceiptModal = signal(false);
  readonly selectedReceipt = signal<Receipt | null>(null);

  showPaymentModal = false;
  payingReceipt: Receipt | null = null;

  readonly paymentForm = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
  });

  readonly customerReceipts = computed(() => customerReceipts(this.receipts(), this.customerId()));
  readonly totalOutstanding = computed(() =>
    customerOutstandingCredit(this.receipts(), this.customerId()),
  );
  readonly outstandingReceipts = computed(() =>
    this.customerReceipts().filter((r) => r.type === 'sale' && r.totals.remainingAmount > 0),
  );

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id') ?? '';
      this.customerId.set(id);
      void this.loadData(id);
    });
  }

  private async loadData(id: string): Promise<void> {
    if (!id) {
      this.error.set('Customer not found.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.auth.ensureSessionForDatabase();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }

    this.customersService
      .watchCustomers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          const found = rows.find((c) => c.id === id) ?? null;
          this.customer.set(found);
          if (!found && !this.loading()) {
            this.error.set('Customer not found.');
          }
        },
        error: (err: unknown) => this.error.set(mapDataErrorMessage(err)),
      });

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
  }

  receiptTypeLabel(r: Receipt): string {
    return r.type === 'refund' ? 'Refund' : 'Sale';
  }

  receiptTypeSeverity(r: Receipt): 'success' | 'warn' | 'danger' | 'info' {
    if (r.type === 'refund') return 'danger';
    if (r.totals.remainingAmount > 0) return 'warn';
    return 'success';
  }

  paymentStatus(r: Receipt): string {
    if (r.type === 'refund') return 'Refund';
    if (r.totals.remainingAmount <= 0) return 'Paid';
    if (r.totals.paidAmount <= 0) return 'Credit';
    return 'Partial';
  }

  openReceipt(r: Receipt): void {
    this.selectedReceipt.set(r);
    this.showReceiptModal.set(true);
  }

  closeReceipt(): void {
    this.showReceiptModal.set(false);
    this.selectedReceipt.set(null);
  }

  lineTotal(l: ReceiptLineItem): number {
    return receiptLineTotal(l);
  }

  openPayment(r: Receipt): void {
    this.payingReceipt = r;
    this.paymentForm.reset({ amount: r.totals.remainingAmount });
    this.showPaymentModal = true;
  }

  onPaymentClosed(): void {
    this.showPaymentModal = false;
    this.payingReceipt = null;
  }

  async submitPayment(): Promise<void> {
    if (!this.payingReceipt || this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    const amount = this.paymentForm.getRawValue().amount;
    const r = this.payingReceipt;
    const customerId = this.customerId();

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.creditPaymentsService.receivePayment(r.id, customerId, amount);
      this.showPaymentModal = false;
      this.payingReceipt = null;
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
