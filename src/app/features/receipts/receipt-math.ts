import type { Product } from '../products/products.service';
import { soldQuantityToBaseUnits } from '../products/products.service';
import type { ReceiptLineItem } from './receipts.service';

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

export function lineItemCost(product: Product, line: ReceiptLineItem): number {
  const baseQty = soldQuantityToBaseUnits(product, Math.abs(line.quantity), line.unitLabel);
  let cost = 0;
  if (product.type === 'count') {
    cost = baseQty * product.cost;
  } else {
    const cf = product.conversionFactor > 0 ? product.conversionFactor : 1;
    cost = (baseQty / cf) * product.cost;
  }
  return line.quantity < 0 ? -cost : cost;
}

export function computeReceiptProfitTotals(
  lines: ReceiptLineItem[],
  products: Product[],
): { totalCost: number; totalProfit: number } {
  const byId = new Map(products.map((p) => [p.id, p]));
  let totalCost = 0;
  let totalProfit = 0;
  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p) continue;
    const cost = lineItemCost(p, line);
    totalCost += cost;
    totalProfit += receiptLineTotal(line) - cost;
  }
  return { totalCost, totalProfit };
}
