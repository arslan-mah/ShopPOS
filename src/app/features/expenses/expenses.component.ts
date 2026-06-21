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
import { TextareaModule } from 'primeng/textarea';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import {
  Expense,
  ExpenseCategory,
  ExpenseDraft,
  ExpensesService,
} from './expenses.service';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Card', 'Cheque', 'Other'];

@Component({
  selector: 'app-expenses',
  imports: [
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss',
})
export class ExpensesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly expensesService = inject(ExpensesService);

  readonly items = signal<Expense[]>([]);
  readonly categories = signal<ExpenseCategory[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly search = signal('');
  readonly categoryFilter = signal('');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');

  readonly paymentMethods = PAYMENT_METHODS;

  showFormModal = false;
  editingId: string | null = null;

  readonly form = this.fb.nonNullable.group({
    categoryId: [''],
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.maxLength(1000)]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    paymentMethod: ['Cash', [Validators.required]],
    date: [this.todayIso(), [Validators.required]],
  });

  readonly filteredItems = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.categoryFilter();
    const from = this.parseFilterDate(this.dateFrom());
    const toEnd = this.parseFilterDateEnd(this.dateTo());

    return this.items().filter((e) => {
      if (cat && e.categoryId !== cat) return false;
      if (q) {
        const hay = `${e.title} ${e.description ?? ''} ${e.paymentMethod}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const d = e.date?.getTime() ?? 0;
      if (from && d < from.getTime()) return false;
      if (toEnd && d > toEnd.getTime()) return false;
      return true;
    });
  });

  readonly filteredTotal = computed(() =>
    this.filteredItems().reduce((sum, e) => sum + e.amount, 0),
  );

  ngOnInit(): void {
    void this.initData();
  }

  private async initData(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
      await this.expensesService.ensureDefaultCategories();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }

    this.expensesService
      .watchExpenseCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.categories.set(rows),
        error: (err: unknown) => this.error.set(mapDataErrorMessage(err)),
      });

    this.expensesService
      .watchExpenses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.items.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  categoryName(id?: string): string {
    if (!id) return '—';
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }

  openAdd(): void {
    this.editingId = null;
    this.form.reset({
      categoryId: '',
      title: '',
      description: '',
      amount: 0,
      paymentMethod: 'Cash',
      date: this.todayIso(),
    });
    this.showFormModal = true;
  }

  openEdit(e: Expense): void {
    this.editingId = e.id;
    this.form.reset({
      categoryId: e.categoryId ?? '',
      title: e.title,
      description: e.description ?? '',
      amount: e.amount,
      paymentMethod: e.paymentMethod || 'Cash',
      date: e.date ? this.toIsoDate(e.date) : this.todayIso(),
    });
    this.showFormModal = true;
  }

  onFormClosed(): void {
    this.showFormModal = false;
    this.editingId = null;
  }

  async saveExpense(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const draft: ExpenseDraft = {
      categoryId: v.categoryId || undefined,
      title: v.title,
      description: v.description || undefined,
      amount: v.amount,
      paymentMethod: v.paymentMethod,
      date: new Date(v.date + 'T12:00:00'),
    };

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      if (this.editingId) {
        await this.expensesService.updateExpense(this.editingId, draft);
      } else {
        await this.expensesService.addExpense(draft);
      }
      this.showFormModal = false;
      this.editingId = null;
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteExpense(e: Expense): Promise<void> {
    if (!confirm(`Delete expense "${e.title}"?`)) return;
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.expensesService.deleteExpense(e.id);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    }
  }

  clearFilters(): void {
    this.search.set('');
    this.categoryFilter.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  private todayIso(): string {
    return this.toIsoDate(new Date());
  }

  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private parseFilterDate(iso: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseFilterDateEnd(iso: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso + 'T23:59:59.999');
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
