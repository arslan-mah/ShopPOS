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
import type { ReceiptLineItem } from '../receipts/receipts.service';
import { StockMovementsService } from '../stock/stock-movements.service';

export type ProductUnitType = 'weight' | 'volume' | 'count';

/** Stock entry mode for weight / volume only (not used for count — count uses cartons × pieces). */
export type StockInputMode = 'base' | 'selling';

export interface Product {
  id: string;
  name: string;
  type: ProductUnitType;
  baseUnit: string;
  sellingUnit: string;
  conversionFactor: number;
  /** Weight / volume: price per selling unit (kg, L). Use 0 for count products. */
  pricePerUnit: number;
  /** Count: price per single piece. Use 0 for weight/volume. */
  pricePerPiece: number;
  /** Your purchase cost: per piece (count) or per selling unit (weight/volume). */
  cost: number;
  stockInBaseUnit: number;
  lowStockThreshold: number;
  piecesPerCarton: number;
  hasExpiry: boolean;
  expiryDate: string | null;
  barcode?: string;
  createdAt: Date | null;
}

export type ProductDraft = Omit<Product, 'id' | 'createdAt'>;

/** Convert sold quantity on a receipt line into stored base units. */
export function soldQuantityToBaseUnits(
  product: Product,
  quantity: number,
  unitLabel?: string,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  const label = (unitLabel ?? '').trim().toLowerCase();

  if (product.type === 'count') {
    const ppc = Math.max(1, product.piecesPerCarton);
    const selling = product.sellingUnit.trim().toLowerCase();
    if (label === 'carton' || label === selling || label === 'cartons') {
      return quantity * ppc;
    }
    return quantity;
  }

  if (product.type === 'weight' || product.type === 'volume') {
    const cf = product.conversionFactor > 0 ? product.conversionFactor : 1;
    const base = product.baseUnit.trim().toLowerCase();
    if (label === base) {
      return quantity;
    }
    return quantity * cf;
  }

  return quantity;
}

/** Convert user-entered quantity into stored base units (g, ml, or pieces). */
export function stockQuantityToBase(params: {
  type: ProductUnitType;
  conversionFactor: number;
  piecesPerCarton: number;
  mode: StockInputMode | 'carton';
  quantity: number;
}): number {
  const q = params.quantity;
  if (!Number.isFinite(q) || q < 0) {
    return 0;
  }
  const cf = params.conversionFactor > 0 ? params.conversionFactor : 1;
  const ppc = Math.max(1, params.piecesPerCarton || 1);

  if (params.type === 'count') {
    return params.mode === 'carton' ? q * ppc : q;
  }
  if (params.type === 'weight' || params.type === 'volume') {
    return params.mode === 'selling' ? q * cf : q;
  }
  return q;
}

export function baseStockToDisplayQuantity(
  stockInBaseUnit: number,
  type: ProductUnitType,
  conversionFactor: number,
  piecesPerCarton: number,
  mode: StockInputMode | 'carton',
): number {
  const cf = conversionFactor > 0 ? conversionFactor : 1;
  const ppc = Math.max(1, piecesPerCarton || 1);
  if (type === 'weight' || type === 'volume') {
    return mode === 'selling' ? stockInBaseUnit / cf : stockInBaseUnit;
  }
  if (type === 'count') {
    return mode === 'carton' ? stockInBaseUnit / ppc : stockInBaseUnit;
  }
  return stockInBaseUnit;
}

/** Total stock value at purchase cost (cost × qty in selling unit / pieces). */
export function productInventoryValue(p: Product): number {
  if (p.cost <= 0 || p.stockInBaseUnit <= 0) return 0;
  if (p.type === 'count') {
    return p.stockInBaseUnit * p.cost;
  }
  const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
  return (p.stockInBaseUnit / cf) * p.cost;
}

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly db = inject(REALTIME_DATABASE);
  private readonly stockMovements = inject(StockMovementsService);

  watchProducts(): Observable<Product[]> {
    const productsQuery = query(ref(this.db, 'products'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        productsQuery,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows: Product[] = Object.entries(val).map(([id, data]) => mapProductRecord(id, data));
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addProduct(draft: ProductDraft): Promise<void> {
    const listRef = ref(this.db, 'products');
    const newRef = push(listRef);
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      type: draft.type,
      baseUnit: draft.baseUnit.trim(),
      sellingUnit: draft.sellingUnit.trim(),
      conversionFactor: draft.conversionFactor,
      stockInBaseUnit: draft.stockInBaseUnit,
      lowStockThreshold: draft.lowStockThreshold,
      piecesPerCarton: draft.type === 'count' ? Math.max(1, draft.piecesPerCarton) : 1,
      hasExpiry: draft.hasExpiry,
      expiryDate: draft.hasExpiry && draft.expiryDate ? draft.expiryDate : null,
      createdAt: serverTimestamp(),
    };
    payload['barcode'] = draft.barcode?.trim() ?? '';
    payload['cost'] = draft.cost >= 0 ? draft.cost : 0;
    if (draft.type === 'count') {
      payload['pricePerPiece'] = draft.pricePerPiece;
      payload['pricePerUnit'] = 0;
    } else {
      payload['pricePerUnit'] = draft.pricePerUnit;
      payload['pricePerPiece'] = 0;
    }
    await set(newRef, payload);
  }

  async updateProduct(id: string, draft: ProductDraft): Promise<void> {
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      type: draft.type,
      baseUnit: draft.baseUnit.trim(),
      sellingUnit: draft.sellingUnit.trim(),
      conversionFactor: draft.conversionFactor,
      lowStockThreshold: draft.lowStockThreshold,
      piecesPerCarton: draft.type === 'count' ? Math.max(1, draft.piecesPerCarton) : 1,
      hasExpiry: draft.hasExpiry,
      expiryDate: draft.hasExpiry && draft.expiryDate ? draft.expiryDate : null,
      cost: draft.cost >= 0 ? draft.cost : 0,
      barcode: draft.barcode?.trim() ?? '',
    };
    if (draft.type === 'count') {
      payload['pricePerPiece'] = draft.pricePerPiece;
      payload['pricePerUnit'] = 0;
    } else {
      payload['pricePerUnit'] = draft.pricePerUnit;
      payload['pricePerPiece'] = 0;
    }
    await update(ref(this.db, `products/${id}`), payload);
  }

  async updateStock(id: string, stockInBaseUnit: number): Promise<void> {
    await update(ref(this.db, `products/${id}`), { stockInBaseUnit });
  }

  /** Reduce stock after a sale based on receipt line qty + unit label. */
  async deductStockForReceiptLines(
    lines: ReceiptLineItem[],
    products: Product[],
    referenceId?: string,
  ): Promise<void> {
    const byId = new Map(products.map((p) => [p.id, p]));
    const deductedByProduct = new Map<string, number>();

    for (const line of lines) {
      const p = byId.get(line.productId);
      if (!p) continue;
      const units = soldQuantityToBaseUnits(p, Math.abs(line.quantity), line.unitLabel);
      deductedByProduct.set(p.id, (deductedByProduct.get(p.id) ?? 0) + units);
    }

    for (const [id, deduct] of deductedByProduct) {
      const p = byId.get(id);
      if (!p || deduct <= 0) continue;
      const next = Math.max(0, p.stockInBaseUnit - deduct);
      await this.updateStock(id, next);
      await this.stockMovements.logMovement({
        productId: id,
        productName: p.name,
        type: 'sale',
        quantityInBaseUnit: deduct,
        referenceId,
      });
    }
  }

  /** Restore stock after a refund (negative-quantity receipt lines). */
  async restoreStockForReceiptLines(
    lines: ReceiptLineItem[],
    products: Product[],
    referenceId?: string,
  ): Promise<void> {
    const byId = new Map(products.map((p) => [p.id, p]));
    const restoredByProduct = new Map<string, number>();

    for (const line of lines) {
      const p = byId.get(line.productId);
      if (!p) continue;
      const units = soldQuantityToBaseUnits(p, Math.abs(line.quantity), line.unitLabel);
      restoredByProduct.set(p.id, (restoredByProduct.get(p.id) ?? 0) + units);
    }

    for (const [id, restore] of restoredByProduct) {
      const p = byId.get(id);
      if (!p || restore <= 0) continue;
      const next = p.stockInBaseUnit + restore;
      await this.updateStock(id, next);
      await this.stockMovements.logMovement({
        productId: id,
        productName: p.name,
        type: 'refund',
        quantityInBaseUnit: restore,
        referenceId,
      });
    }
  }

  async deleteProduct(id: string): Promise<void> {
    await remove(ref(this.db, `products/${id}`));
  }
}

function mapProductRecord(id: string, data: Record<string, unknown>): Product {
  const type = parseType(data['type']);

  const legacyPu = num(data, 'pricePerUnit', NaN);
  const oldPrice = num(data, 'price', NaN);
  const legacyPp = num(data, 'pricePerPiece', NaN);

  let pricePerUnit = 0;
  let pricePerPiece = 0;

  if (type === 'count') {
    pricePerPiece = Number.isFinite(legacyPp)
      ? legacyPp
      : Number.isFinite(legacyPu)
        ? legacyPu
        : Number.isFinite(oldPrice)
          ? oldPrice
          : 0;
  } else {
    pricePerUnit = Number.isFinite(legacyPu)
      ? legacyPu
      : Number.isFinite(oldPrice)
        ? oldPrice
        : 0;
  }

  const ppc = num(data, 'piecesPerCarton', NaN);
  const piecesPerCarton = Number.isFinite(ppc) && ppc >= 1 ? Math.floor(ppc) : 1;

  return {
    id,
    name: str(data, 'name'),
    type,
    baseUnit: str(data, 'baseUnit', 'pc'),
    sellingUnit: str(data, 'sellingUnit', 'pc'),
    conversionFactor: (() => {
      const cf = num(data, 'conversionFactor', NaN);
      return Number.isFinite(cf) && cf > 0 ? cf : 1;
    })(),
    pricePerUnit,
    pricePerPiece,
    cost: num(data, 'cost', 0),
    stockInBaseUnit: num(data, 'stockInBaseUnit', 0),
    lowStockThreshold: num(data, 'lowStockThreshold', 0),
    piecesPerCarton,
    hasExpiry: bool(data, 'hasExpiry', false),
    expiryDate: parseExpiryDate(data['expiryDate']),
    barcode: str(data, 'barcode') || undefined,
    createdAt: parseCreatedAt(data['createdAt']),
  };
}

function str(data: Record<string, unknown>, key: string, fallback = ''): string {
  const v = data[key];
  return typeof v === 'string' ? v : fallback;
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function bool(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = data[key];
  return typeof v === 'boolean' ? v : fallback;
}

function parseType(v: unknown): ProductUnitType {
  if (v === 'weight' || v === 'volume' || v === 'count') {
    return v;
  }
  return 'count';
}

function parseExpiryDate(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) {
    return v.trim();
  }
  return null;
}

function parseCreatedAt(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return new Date(v);
  }
  return null;
}
