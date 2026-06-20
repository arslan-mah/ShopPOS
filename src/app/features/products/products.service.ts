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
  createdAt: Date | null;
}

export type ProductDraft = Omit<Product, 'id' | 'createdAt'>;

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

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly db = inject(REALTIME_DATABASE);

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

  async updateStock(id: string, stockInBaseUnit: number): Promise<void> {
    await update(ref(this.db, `products/${id}`), { stockInBaseUnit });
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
