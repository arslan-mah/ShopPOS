import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { DEFAULT_SHOP_SETTINGS, ShopSettingsService } from './shop-settings.service';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, CardModule, ButtonModule, MessageModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly settingsService = inject(ShopSettingsService);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    shopName: ['', [Validators.required, Validators.maxLength(200)]],
    address: ['', [Validators.maxLength(1000)]],
    phone: ['', [Validators.maxLength(30)]],
    logo: [''],
    taxPercent: [0, [Validators.min(0)]],
    currency: ['Rs.', [Validators.required, Validators.maxLength(10)]],
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
      this.settingsService
        .watchSettings()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (s) => this.form.patchValue(s),
        });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load settings.');
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.settingsService.saveSettings(this.form.getRawValue());
      this.success.set('Settings saved.');
    } catch (e: unknown) {
      this.error.set(mapDataErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
