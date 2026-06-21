import { inject, Injectable } from '@angular/core';
import { onValue, orderByChild, push, query, ref, serverTimestamp, set } from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export type StockMovementType = 'sale' | 'refund' | 'purchase' | 'adjustment';

export interface StockMovement {
  id: string;
  productId: string;
  productName?: string;
  type: StockMovementType;
  /** Quantity in base units (always positive). */
  quantity: number;
  referenceId?: string;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class StockMovementsService {
  private readonly db = inject(REALTIME_DATABASE);

  watchMovements(): Observable<StockMovement[]> {
    const q = query(ref(this.db, 'stockMovements'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapMovement(id, data));
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async logMovement(params: {
    productId: string;
    productName?: string;
    type: StockMovementType;
    quantityInBaseUnit: number;
    referenceId?: string;
  }): Promise<void> {
    const qty = Math.abs(params.quantityInBaseUnit);
    if (qty <= 0) return;
    const newRef = push(ref(this.db, 'stockMovements'));
    await set(newRef, {
      productId: params.productId,
      productName: params.productName?.trim() ?? '',
      type: params.type,
      quantity: qty,
      referenceId: params.referenceId ?? '',
      createdAt: serverTimestamp(),
    });
  }

  async logMovements(
    entries: {
      productId: string;
      productName?: string;
      type: StockMovementType;
      quantityInBaseUnit: number;
      referenceId?: string;
    }[],
  ): Promise<void> {
    for (const e of entries) {
      await this.logMovement(e);
    }
  }
}

function mapMovement(id: string, data: Record<string, unknown>): StockMovement {
  const type = data['type'];
  const valid: StockMovementType[] = ['sale', 'refund', 'purchase', 'adjustment'];
  return {
    id,
    productId: str(data['productId'], ''),
    productName: str(data['productName'], '') || undefined,
    type: valid.includes(type as StockMovementType) ? (type as StockMovementType) : 'adjustment',
    quantity: num(data['quantity'], 0),
    referenceId: str(data['referenceId'], '') || undefined,
    createdAt: parseTs(data['createdAt']),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function parseTs(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return new Date(v);
  return null;
}
