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
} from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export type ReceiptCustomerMode = 'registered' | 'guest';

export interface ReceiptRegisteredCustomerRef {
  mode: 'registered';
  customerId: string;
  fullName: string;
  address: string;
  phone: string;
  cnic: string;
}

export interface ReceiptGuestCustomerRef {
  mode: 'guest';
  fullName: string;
  address: string;
  phone: string;
  cnic: string;
}

export type ReceiptCustomerRef = ReceiptRegisteredCustomerRef | ReceiptGuestCustomerRef;

export interface ReceiptLineItem {
  productId: string;
  productName: string;
  unitPrice: number; // in the receipt's chosen selling unit
  quantity: number;
  /** e.g. pc, carton, kg — used to deduct stock correctly */
  unitLabel?: string;
  discountPercent: number;
  taxPercent: number;
}

export interface ReceiptTotals {
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
}

export interface Receipt {
  id: string;
  shopName: string;
  shopAddress: string;
  invoiceNumber: string;
  createdAt: Date | null;
  customer: ReceiptCustomerRef;
  lines: ReceiptLineItem[];
  totals: ReceiptTotals;
  paymentMethod: string;
}

export interface ReceiptDraft {
  shopName: string;
  shopAddress: string;
  invoiceNumber: string;
  customer: ReceiptCustomerRef;
  lines: ReceiptLineItem[];
  totals: ReceiptTotals;
  paymentMethod: string;
}

@Injectable({ providedIn: 'root' })
export class ReceiptsService {
  private readonly db = inject(REALTIME_DATABASE);

  watchReceipts(): Observable<Receipt[]> {
    const receiptsQuery = query(ref(this.db, 'receipts'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        receiptsQuery,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows: Receipt[] = Object.entries(val).map(([id, data]) => mapReceiptRecord(id, data));
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addReceipt(draft: ReceiptDraft): Promise<string> {
    const listRef = ref(this.db, 'receipts');
    const newRef = push(listRef);
    await set(newRef, {
      shopName: draft.shopName.trim(),
      shopAddress: draft.shopAddress.trim(),
      invoiceNumber: draft.invoiceNumber.trim(),
      createdAt: serverTimestamp(),
      customer: draft.customer,
      lines: draft.lines,
      totals: {
        grandTotal: draft.totals.grandTotal,
        paidAmount: draft.totals.paidAmount,
        remainingAmount: draft.totals.remainingAmount,
      },
      paymentMethod: draft.paymentMethod.trim(),
    });
    return newRef.key as string;
  }

  async deleteReceipt(id: string): Promise<void> {
    await remove(ref(this.db, `receipts/${id}`));
  }
}

function mapReceiptRecord(id: string, data: Record<string, unknown>): Receipt {
  const createdAt = parseCreatedAt(data['createdAt']);
  const customer = mapCustomerRef(data['customer']);
  const lines = Array.isArray(data['lines']) ? (data['lines'] as ReceiptLineItem[]) : [];
  const totals = mapTotals(data['totals']);
  return {
    id,
    shopName: str(data['shopName'], ''),
    shopAddress: str(data['shopAddress'], ''),
    invoiceNumber: str(data['invoiceNumber'], ''),
    createdAt,
    customer,
    lines,
    totals,
    paymentMethod: str(data['paymentMethod'], ''),
  };
}

function mapCustomerRef(v: unknown): ReceiptCustomerRef {
  const raw = (v ?? {}) as Record<string, unknown>;
  const mode = raw['mode'] === 'registered' ? 'registered' : 'guest';
  if (mode === 'registered') {
    return {
      mode: 'registered',
      customerId: str(raw['customerId'], ''),
      fullName: str(raw['fullName'], ''),
      address: str(raw['address'], ''),
      phone: str(raw['phone'], ''),
      cnic: str(raw['cnic'], ''),
    };
  }
  return {
    mode: 'guest',
    fullName: str(raw['fullName'], ''),
    address: str(raw['address'], ''),
    phone: str(raw['phone'], ''),
    cnic: str(raw['cnic'], ''),
  };
}

function mapTotals(v: unknown): ReceiptTotals {
  const raw = (v ?? {}) as Record<string, unknown>;
  return {
    grandTotal: num(raw['grandTotal'], 0),
    paidAmount: num(raw['paidAmount'], 0),
    remainingAmount: num(raw['remainingAmount'], 0),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function parseCreatedAt(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return new Date(v);
  }
  return null;
}

