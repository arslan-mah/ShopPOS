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

export type ReceiptType = 'sale' | 'refund';

export interface ReceiptLineItem {
  productId: string;
  productName: string;
  unitPrice: number; // in the receipt's chosen selling unit
  quantity: number;
  /** e.g. pc, carton, kg — used to deduct stock correctly */
  unitLabel?: string;
  discountPercent: number;
  taxPercent: number;
  /** Index on the original sale receipt line (refund receipts only) */
  originalLineIndex?: number;
}

export interface ReceiptTotals {
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
}

export interface Receipt {
  id: string;
  type: ReceiptType;
  shopName: string;
  shopAddress: string;
  invoiceNumber: string;
  createdAt: Date | null;
  customer: ReceiptCustomerRef;
  lines: ReceiptLineItem[];
  totals: ReceiptTotals;
  paymentMethod: string;
  /** Sale receipt that this refund applies to */
  originalReceiptId?: string;
  originalInvoiceNumber?: string;
}

export interface ReceiptDraft {
  type?: ReceiptType;
  shopName: string;
  shopAddress: string;
  invoiceNumber: string;
  customer: ReceiptCustomerRef;
  lines: ReceiptLineItem[];
  totals: ReceiptTotals;
  paymentMethod: string;
  originalReceiptId?: string;
  originalInvoiceNumber?: string;
}

export interface RefundableLineState {
  lineIndex: number;
  line: ReceiptLineItem;
  originalQty: number;
  alreadyRefunded: number;
  refundableQty: number;
  refundQty: number;
  selected: boolean;
}

export function receiptLineTotal(l: ReceiptLineItem): number {
  const qty = Math.abs(l.quantity);
  const subtotal = l.unitPrice * qty;
  const afterDiscount = subtotal - subtotal * (l.discountPercent / 100);
  const tax = afterDiscount * (l.taxPercent / 100);
  const total = afterDiscount + tax;
  return l.quantity < 0 ? -total : total;
}

export function receiptGrandTotal(lines: ReceiptLineItem[]): number {
  return lines.reduce((sum, l) => sum + receiptLineTotal(l), 0);
}

/** Sum quantities already refunded per original line index. */
export function refundedQtyByLineIndex(originalReceiptId: string, allReceipts: Receipt[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of allReceipts) {
    if (r.type !== 'refund' || r.originalReceiptId !== originalReceiptId) continue;
    for (const line of r.lines) {
      const idx = line.originalLineIndex;
      if (idx === undefined || idx < 0) continue;
      const qty = Math.abs(line.quantity);
      map.set(idx, (map.get(idx) ?? 0) + qty);
    }
  }
  return map;
}

export function buildRefundableLines(original: Receipt, allReceipts: Receipt[]): RefundableLineState[] {
  const refunded = refundedQtyByLineIndex(original.id, allReceipts);
  return original.lines.map((line, lineIndex) => {
    const originalQty = Math.abs(line.quantity);
    const alreadyRefunded = refunded.get(lineIndex) ?? 0;
    const refundableQty = Math.max(0, originalQty - alreadyRefunded);
    return {
      lineIndex,
      line,
      originalQty,
      alreadyRefunded,
      refundableQty,
      refundQty: 0,
      selected: false,
    };
  });
}

export function hasRefundableQuantity(original: Receipt, allReceipts: Receipt[]): boolean {
  return buildRefundableLines(original, allReceipts).some((l) => l.refundableQty > 0);
}

function generateRefundInvoiceNumber(originalInvoiceNumber: string): string {
  const rnd = Math.floor(Math.random() * 1_000_000);
  const base = originalInvoiceNumber.trim() || 'INV';
  return `REF-${base}-${Date.now()}-${rnd}`;
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
    const type: ReceiptType = draft.type ?? 'sale';
    const payload: Record<string, unknown> = {
      type,
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
    };
    if (draft.originalReceiptId) {
      payload['originalReceiptId'] = draft.originalReceiptId;
    }
    if (draft.originalInvoiceNumber) {
      payload['originalInvoiceNumber'] = draft.originalInvoiceNumber;
    }
    await set(newRef, payload);
    return newRef.key as string;
  }

  async addRefundReceipt(
    original: Receipt,
    refundableLines: RefundableLineState[],
  ): Promise<string> {
    const selected = refundableLines.filter((l) => l.selected && l.refundQty > 0);
    if (selected.length === 0) {
      throw new Error('Select at least one product to refund.');
    }

    for (const row of selected) {
      if (row.refundQty > row.refundableQty) {
        throw new Error(`Refund quantity exceeds remaining for ${row.line.productName}.`);
      }
    }

    const lines: ReceiptLineItem[] = selected.map((row) => ({
      productId: row.line.productId,
      productName: row.line.productName,
      unitPrice: row.line.unitPrice,
      quantity: -row.refundQty,
      unitLabel: row.line.unitLabel,
      discountPercent: row.line.discountPercent,
      taxPercent: row.line.taxPercent,
      originalLineIndex: row.lineIndex,
    }));

    const grandTotal = receiptGrandTotal(lines);
    const draft: ReceiptDraft = {
      type: 'refund',
      shopName: original.shopName,
      shopAddress: original.shopAddress,
      invoiceNumber: generateRefundInvoiceNumber(original.invoiceNumber),
      customer: original.customer,
      lines,
      totals: {
        grandTotal,
        paidAmount: grandTotal,
        remainingAmount: 0,
      },
      paymentMethod: original.paymentMethod,
      originalReceiptId: original.id,
      originalInvoiceNumber: original.invoiceNumber,
    };

    return this.addReceipt(draft);
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
  const type: ReceiptType = data['type'] === 'refund' ? 'refund' : 'sale';
  const originalReceiptId = str(data['originalReceiptId'], '').trim() || undefined;
  const originalInvoiceNumber = str(data['originalInvoiceNumber'], '').trim() || undefined;
  return {
    id,
    type,
    shopName: str(data['shopName'], ''),
    shopAddress: str(data['shopAddress'], ''),
    invoiceNumber: str(data['invoiceNumber'], ''),
    createdAt,
    customer,
    lines,
    totals,
    paymentMethod: str(data['paymentMethod'], ''),
    originalReceiptId,
    originalInvoiceNumber,
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

