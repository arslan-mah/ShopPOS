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
import { AuthService } from '../../core/auth/auth.service';
import { PermissionsService, ShopUserProfile } from '../../core/auth/permissions.service';
import { USER_ROLES, UserRole } from '../../core/auth/roles';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { UsersService } from './users.service';

@Component({
  selector: 'app-users',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly usersService = inject(UsersService);
  private readonly permissions = inject(PermissionsService);

  readonly roles = USER_ROLES;
  readonly items = signal<ShopUserProfile[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  showFormModal = false;
  editingUser: ShopUserProfile | null = null;

  readonly form = this.fb.nonNullable.group({
    uid: ['', [Validators.required, Validators.maxLength(128)]],
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    role: ['cashier' as UserRole, [Validators.required]],
    active: [true],
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
    this.usersService
      .watchUsers()
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
    this.editingUser = null;
    this.form.reset({
      uid: '',
      email: '',
      displayName: '',
      role: 'cashier',
      active: true,
    });
    this.form.controls.uid.enable();
    this.showFormModal = true;
    this.error.set(null);
  }

  openEdit(user: ShopUserProfile): void {
    this.editingUser = user;
    this.form.reset({
      uid: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
    });
    this.form.controls.uid.disable();
    this.showFormModal = true;
    this.error.set(null);
  }

  onFormClosed(): void {
    this.editingUser = null;
    this.error.set(null);
  }

  roleSeverity(role: string): 'success' | 'info' {
    return role === 'admin' ? 'success' : 'info';
  }

  async saveUser(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const raw = this.form.getRawValue();
    const isNew = !this.editingUser;
    try {
      await this.auth.ensureSessionForDatabase();
      await this.usersService.saveUser(
        {
          uid: raw.uid,
          email: raw.email,
          displayName: raw.displayName,
          role: raw.role,
          active: raw.active,
        },
        isNew,
      );
      this.showFormModal = false;
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteUser(user: ShopUserProfile): Promise<void> {
    if (user.id === this.permissions.profile()?.id) {
      this.error.set('You cannot delete your own profile.');
      return;
    }
    if (!confirm(`Remove profile for ${user.displayName || user.email}? (Firebase Auth account is not deleted.)`)) {
      return;
    }
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.usersService.deleteUser(user.id);
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    }
  }
}
