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
import { Supplier, SupplierDraft, SuppliersService } from './suppliers.service';

@Component({
  selector: 'app-suppliers',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './suppliers.component.html',
  styleUrl: './suppliers.component.scss',
})
export class SuppliersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly suppliersService = inject(SuppliersService);

  readonly items = signal<Supplier[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  showFormModal = false;
  editingId: string | null = null;

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    phone: ['', [Validators.maxLength(30)]],
    address: ['', [Validators.maxLength(500)]],
    notes: ['', [Validators.maxLength(1000)]],
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
    this.suppliersService
      .watchSuppliers()
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

  openAdd(): void {
    this.editingId = null;
    this.form.reset({ name: '', phone: '', address: '', notes: '' });
    this.showFormModal = true;
  }

  openEdit(s: Supplier): void {
    this.editingId = s.id;
    this.form.reset({
      name: s.name,
      phone: s.phone,
      address: s.address,
      notes: s.notes ?? '',
    });
    this.showFormModal = true;
  }

  onFormClosed(): void {
    this.showFormModal = false;
    this.editingId = null;
  }

  async saveSupplier(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const draft: SupplierDraft = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      if (this.editingId) {
        await this.suppliersService.updateSupplier(this.editingId, draft);
      } else {
        await this.suppliersService.addSupplier(draft);
      }
      this.showFormModal = false;
      this.editingId = null;
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteSupplier(s: Supplier): Promise<void> {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.suppliersService.deleteSupplier(s.id);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    }
  }
}
