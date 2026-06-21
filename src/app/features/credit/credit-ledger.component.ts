import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { CreditPaymentsService } from './credit-payments.service';
import { Receipt, ReceiptCustomerRef, ReceiptsService } from '../receipts/receipts.service';

export interface CreditCustomerGroup {
  customerId: string;
  customerName: string;
  customerPhone: string;
  totalOutstanding: number;
  receipts: Receipt[];
}

@Component({
  selector: 'app-credit-ledger',
  imports: [
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './credit-ledger.component.html',
  styleUrl: './credit-ledger.component.scss',
})
export class CreditLedgerComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly receiptsService = inject(ReceiptsService);
  private readonly creditPaymentsService = inject(CreditPaymentsService);

  readonly receipts = signal<Receipt[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  showPaymentModal = false;
  payingReceipt: Receipt | null = null;

  readonly paymentForm = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
  });

  readonly customerGroups = computed((): CreditCustomerGroup[] => {
    const outstanding = this.receipts().filter(
      (r) => r.type === 'sale' && r.totals.remainingAmount > 0,
    );
    const map = new Map<string, CreditCustomerGroup>();

    for (const r of outstanding) {
      const key = this.customerKey(r.customer);
      const name = r.customer.fullName || 'Unknown';
      const phone = r.customer.phone || '';
      const existing = map.get(key);
      if (existing) {
        existing.receipts.push(r);
        existing.totalOutstanding += r.totals.remainingAmount;
      } else {
        map.set(key, {
          customerId: key,
          customerName: name,
          customerPhone: phone,
          totalOutstanding: r.totals.remainingAmount,
          receipts: [r],
        });
      }
    }

    return [...map.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  });

  readonly totalOutstanding = computed(() =>
    this.customerGroups().reduce((s, g) => s + g.totalOutstanding, 0),
  );

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

    this.creditPaymentsService
      .watchCreditPayments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (err: unknown) => this.error.set(mapDataErrorMessage(err)) });
  }

  customerKey(c: ReceiptCustomerRef): string {
    if (c.mode === 'registered') return c.customerId;
    return `guest:${c.fullName}:${c.phone}`;
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
    const customerId =
      r.customer.mode === 'registered' ? r.customer.customerId : this.customerKey(r.customer);

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
