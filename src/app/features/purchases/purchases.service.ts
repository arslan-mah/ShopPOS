import { inject, Injectable } from '@angular/core';
import {
  get,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';
import { Product, ProductsService, soldQuantityToBaseUnits } from '../products/products.service';
import { StockMovementsService } from '../stock/stock-movements.service';

export interface PurchaseLine {
  productId: string;
  productName: string;
  quantity: number;
  unitLabel: string;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  supplierId: string;
  supplierName?: string;
  invoiceNumber: string;
  lines: PurchaseLine[];
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: string;
  createdAt: Date | null;
}

export interface PurchaseDraft {
  supplierId: string;
  supplierName?: string;
  invoiceNumber: string;
  lines: PurchaseLine[];
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: string;
}

export type PurchasePaymentMode = 'net' | 'credit' | 'partial';

@Injectable({ providedIn: 'root' })
export class PurchasesService {
  private readonly db = inject(REALTIME_DATABASE);
  private readonly productsService = inject(ProductsService);
  private readonly stockMovements = inject(StockMovementsService);

  watchPurchases(): Observable<Purchase[]> {
    const q = query(ref(this.db, 'purchases'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapPurchase(id, data));
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addPurchase(draft: PurchaseDraft, products: Product[]): Promise<string> {
    const newRef = push(ref(this.db, 'purchases'));
    await set(newRef, {
      supplierId: draft.supplierId,
      supplierName: draft.supplierName?.trim() ?? '',
      invoiceNumber: draft.invoiceNumber.trim(),
      lines: draft.lines,
      total: draft.total,
      paidAmount: draft.paidAmount,
      remainingAmount: draft.remainingAmount,
      paymentMethod: draft.paymentMethod.trim(),
      createdAt: serverTimestamp(),
    });

    const purchaseId = newRef.key as string;

    if (draft.paidAmount > 0) {
      const payRef = push(ref(this.db, 'purchasePayments'));
      await set(payRef, {
        purchaseId,
        supplierId: draft.supplierId,
        amount: draft.paidAmount,
        paymentMethod: draft.paymentMethod.trim(),
        createdAt: serverTimestamp(),
      });
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    const stockDelta = new Map<string, number>();

    for (const line of draft.lines) {
      const p = byId.get(line.productId);
      if (!p) continue;
      const base = soldQuantityToBaseUnits(p, line.quantity, line.unitLabel);
      stockDelta.set(p.id, (stockDelta.get(p.id) ?? 0) + base);
    }

    for (const [productId, addBase] of stockDelta) {
      const p = byId.get(productId);
      if (!p || addBase <= 0) continue;
      await this.productsService.updateStock(productId, p.stockInBaseUnit + addBase);
      await this.stockMovements.logMovement({
        productId,
        productName: p.name,
        type: 'purchase',
        quantityInBaseUnit: addBase,
        referenceId: purchaseId,
      });
    }

    return purchaseId;
  }

  async updatePurchase(
    id: string,
    draft: PurchaseDraft,
    products: Product[],
    previous: Purchase,
  ): Promise<void> {
    await update(ref(this.db, `purchases/${id}`), {
      supplierId: draft.supplierId,
      supplierName: draft.supplierName?.trim() ?? '',
      invoiceNumber: draft.invoiceNumber.trim(),
      lines: draft.lines,
      total: draft.total,
      paidAmount: draft.paidAmount,
      remainingAmount: draft.remainingAmount,
      paymentMethod: draft.paymentMethod.trim(),
    });

    const byId = new Map(products.map((p) => [p.id, p]));
    const oldDelta = stockDeltaForLines(previous.lines, byId);
    const newDelta = stockDeltaForLines(draft.lines, byId);
    const productIds = new Set([...oldDelta.keys(), ...newDelta.keys()]);
    const stockUpdates = new Map<string, number>();

    for (const productId of productIds) {
      const diff = (newDelta.get(productId) ?? 0) - (oldDelta.get(productId) ?? 0);
      if (diff === 0) continue;
      const p = byId.get(productId);
      if (!p) continue;
      stockUpdates.set(productId, p.stockInBaseUnit + diff);
    }

    for (const [productId, newStock] of stockUpdates) {
      const p = byId.get(productId);
      if (!p) continue;
      const diff = newStock - p.stockInBaseUnit;
      await this.productsService.updateStock(productId, newStock);
      await this.stockMovements.logMovement({
        productId,
        productName: p.name,
        type: 'adjustment',
        quantityInBaseUnit: Math.abs(diff),
        referenceId: id,
      });
    }
  }

  async getPurchase(id: string): Promise<Purchase | null> {
    const snap = await get(ref(this.db, `purchases/${id}`));
    if (!snap.exists()) return null;
    return mapPurchase(id, snap.val() as Record<string, unknown>);
  }
}

function mapPurchase(id: string, data: Record<string, unknown>): Purchase {
  const lines = Array.isArray(data['lines']) ? (data['lines'] as PurchaseLine[]) : [];
  const total = num(data['total'], 0);
  const paidAmount = num(data['paidAmount'], total);
  const remainingAmount = num(data['remainingAmount'], Math.max(0, total - paidAmount));
  return {
    id,
    supplierId: str(data['supplierId'], ''),
    supplierName: str(data['supplierName'], '') || undefined,
    invoiceNumber: str(data['invoiceNumber'], ''),
    lines,
    total,
    paidAmount,
    remainingAmount,
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

function stockDeltaForLines(
  lines: PurchaseLine[],
  byId: Map<string, Product>,
): Map<string, number> {
  const delta = new Map<string, number>();
  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p) continue;
    const base = soldQuantityToBaseUnits(p, line.quantity, line.unitLabel);
    delta.set(p.id, (delta.get(p.id) ?? 0) + base);
  }
  return delta;
}
