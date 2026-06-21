import { inject, Injectable } from '@angular/core';
import {
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes?: string;
  createdAt: Date | null;
}

export interface SupplierDraft {
  name: string;
  phone: string;
  address: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class SuppliersService {
  private readonly db = inject(REALTIME_DATABASE);

  watchSuppliers(): Observable<Supplier[]> {
    const q = query(ref(this.db, 'suppliers'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapSupplier(id, data));
          rows.sort((a, b) => a.name.localeCompare(b.name));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addSupplier(draft: SupplierDraft): Promise<void> {
    const newRef = push(ref(this.db, 'suppliers'));
    await set(newRef, {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      notes: draft.notes?.trim() ?? '',
      createdAt: serverTimestamp(),
    });
  }

  async updateSupplier(id: string, draft: SupplierDraft): Promise<void> {
    await update(ref(this.db, `suppliers/${id}`), {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      notes: draft.notes?.trim() ?? '',
    });
  }

  async deleteSupplier(id: string): Promise<void> {
    await remove(ref(this.db, `suppliers/${id}`));
  }
}

function mapSupplier(id: string, data: Record<string, unknown>): Supplier {
  return {
    id,
    name: str(data['name'], ''),
    phone: str(data['phone'], ''),
    address: str(data['address'], ''),
    notes: str(data['notes'], '') || undefined,
    createdAt: parseTs(data['createdAt']),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function parseTs(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return new Date(v);
  return null;
}
