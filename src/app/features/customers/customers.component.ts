import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
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
import { Customer, CustomersService } from './customers.service';

@Component({
  selector: 'app-customers',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    CardModule,
    InputTextModule,
    TextareaModule,
    ButtonModule,
    DialogModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
})
export class CustomersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly customersService = inject(CustomersService);

  readonly items = signal<Customer[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Controls the Add Customer dialog visibility */
  showAddCustomerModal = false;

  readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(200)]],
    address: ['', [Validators.required, Validators.maxLength(1000)]],
    phone: ['', [Validators.maxLength(30)]],
    cnic: ['', [Validators.maxLength(20)]],
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
    this.customersService
      .watchCustomers()
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

  async addCustomer(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { fullName, address, phone, cnic } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.customersService.addCustomer(fullName, address, phone, cnic);
      this.showAddCustomerModal = false;
      this.form.reset({ fullName: '', address: '', phone: '', cnic: '' });
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  onModalClosed(): void {
    this.showAddCustomerModal = false;
  }

  async deleteCustomer(id: string, fullName: string): Promise<void> {
    if (!confirm(`Delete customer "${fullName}"?`)) {
      return;
    }
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.customersService.deleteCustomer(id);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    }
  }
}