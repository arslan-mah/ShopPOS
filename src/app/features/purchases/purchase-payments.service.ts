import { inject, Injectable } from '@angular/core';
import {
  get,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  set,
} from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export interface PurchasePayment {
  id: string;
  purchaseId: string;
  supplierId: string;
  amount: number;
  paymentMethod: string;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class PurchasePaymentsService {
  private readonly db = inject(REALTIME_DATABASE);

  watchPurchasePayments(): Observable<PurchasePayment[]> {
    const q = query(ref(this.db, 'purchasePayments'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapPayment(id, data));
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async paySupplier(
    purchaseId: string,
    supplierId: string,
    amount: number,
    paymentMethod = 'cash',
  ): Promise<void> {
    if (amount <= 0) throw new Error('Payment amount must be greater than zero.');

    const purchaseRef = ref(this.db, `purchases/${purchaseId}`);
    const snap = await get(purchaseRef);
    if (!snap.exists()) throw new Error('Purchase not found.');

    const data = snap.val() as Record<string, unknown>;
    const remaining = num(data['remainingAmount'], 0);
    if (remaining <= 0) throw new Error('This purchase has no outstanding balance.');
    if (amount > remaining) {
      throw new Error(`Payment exceeds remaining balance of ${remaining.toFixed(2)}.`);
    }

    await runTransaction(purchaseRef, (current) => {
      if (!current) return current;
      const rem = num(current['remainingAmount'], 0);
      const paid = num(current['paidAmount'], 0);
      const apply = Math.min(amount, rem);
      current['paidAmount'] = paid + apply;
      current['remainingAmount'] = rem - apply;
      return current;
    });

    const newRef = push(ref(this.db, 'purchasePayments'));
    await set(newRef, {
      purchaseId,
      supplierId,
      amount,
      paymentMethod: paymentMethod.trim() || 'cash',
      createdAt: serverTimestamp(),
    });
  }
}

function mapPayment(id: string, data: Record<string, unknown>): PurchasePayment {
  return {
    id,
    purchaseId: str(data['purchaseId'], ''),
    supplierId: str(data['supplierId'], ''),
    amount: num(data['amount'], 0),
    paymentMethod: str(data['paymentMethod'], 'cash'),
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
