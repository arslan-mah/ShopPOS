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

export interface CreditPayment {
  id: string;
  receiptId: string;
  customerId: string;
  amount: number;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class CreditPaymentsService {
  private readonly db = inject(REALTIME_DATABASE);

  watchCreditPayments(): Observable<CreditPayment[]> {
    const q = query(ref(this.db, 'creditPayments'), orderByChild('createdAt'));
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

  async receivePayment(receiptId: string, customerId: string, amount: number): Promise<void> {
    if (amount <= 0) throw new Error('Payment amount must be greater than zero.');

    const receiptRef = ref(this.db, `receipts/${receiptId}`);
    const snap = await get(receiptRef);
    if (!snap.exists()) throw new Error('Receipt not found.');

    const data = snap.val() as Record<string, unknown>;
    const totals = (data['totals'] ?? {}) as Record<string, unknown>;
    const remaining = num(totals['remainingAmount'], 0);
    if (remaining <= 0) throw new Error('This receipt has no outstanding balance.');
    if (amount > remaining) throw new Error(`Payment exceeds remaining balance of ${remaining.toFixed(2)}.`);

    await runTransaction(receiptRef, (current) => {
      if (!current) return current;
      const t = (current['totals'] ?? {}) as Record<string, unknown>;
      const rem = num(t['remainingAmount'], 0);
      const paid = num(t['paidAmount'], 0);
      const apply = Math.min(amount, rem);
      current['totals'] = {
        ...t,
        paidAmount: paid + apply,
        remainingAmount: rem - apply,
      };
      return current;
    });

    const newRef = push(ref(this.db, 'creditPayments'));
    await set(newRef, {
      receiptId,
      customerId,
      amount,
      createdAt: serverTimestamp(),
    });
  }
}

function mapPayment(id: string, data: Record<string, unknown>): CreditPayment {
  return {
    id,
    receiptId: str(data['receiptId'], ''),
    customerId: str(data['customerId'], ''),
    amount: num(data['amount'], 0),
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
