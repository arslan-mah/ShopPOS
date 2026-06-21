import { inject, Injectable } from '@angular/core';
import { get, onValue, ref, set } from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export interface ShopSettings {
  shopName: string;
  address: string;
  phone: string;
  logo?: string;
  taxPercent: number;
  currency: string;
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  shopName: 'My Shop',
  address: '',
  phone: '',
  logo: '',
  taxPercent: 0,
  currency: 'Rs.',
};

@Injectable({ providedIn: 'root' })
export class ShopSettingsService {
  private readonly db = inject(REALTIME_DATABASE);
  private readonly path = 'settings/shop';

  watchSettings(): Observable<ShopSettings> {
    return new Observable((subscriber) => {
      const settingsRef = ref(this.db, this.path);
      const unsub = onValue(
        settingsRef,
        (snapshot) => {
          const val = snapshot.val() as Record<string, unknown> | null;
          subscriber.next(mapSettings(val));
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async getSettings(): Promise<ShopSettings> {
    const snap = await get(ref(this.db, this.path));
    return mapSettings(snap.val() as Record<string, unknown> | null);
  }

  async saveSettings(settings: ShopSettings): Promise<void> {
    await set(ref(this.db, this.path), {
      shopName: settings.shopName.trim(),
      address: settings.address.trim(),
      phone: settings.phone.trim(),
      logo: settings.logo?.trim() ?? '',
      taxPercent: settings.taxPercent,
      currency: settings.currency.trim() || 'Rs.',
    });
  }
}

function mapSettings(raw: Record<string, unknown> | null): ShopSettings {
  if (!raw) return { ...DEFAULT_SHOP_SETTINGS };
  return {
    shopName: str(raw['shopName'], DEFAULT_SHOP_SETTINGS.shopName),
    address: str(raw['address'], ''),
    phone: str(raw['phone'], ''),
    logo: str(raw['logo'], ''),
    taxPercent: num(raw['taxPercent'], 0),
    currency: str(raw['currency'], 'Rs.'),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}
