import type { Product } from '../../features/products/products.service';
import type { Receipt } from '../../features/receipts/receipts.service';

export function normalizeScanCode(code: string): string {
  return code.trim();
}

export function findProductByBarcode(products: Product[], code: string): Product | undefined {
  const normalized = normalizeScanCode(code);
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  return products.find((p) => (p.barcode || '').trim().toLowerCase() === lower);
}

/** Receipt QR codes encode invoice numbers (e.g. INV-…). */
export function findReceiptByScanCode(receipts: Receipt[], code: string): Receipt | undefined {
  const normalized = normalizeScanCode(code);
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();

  const byInvoice = receipts.find((r) => r.invoiceNumber.trim().toLowerCase() === lower);
  if (byInvoice) return byInvoice;

  const byId = receipts.find((r) => r.id === normalized);
  if (byId) return byId;

  // Strip # prefix if scanner includes it
  const withoutHash = lower.startsWith('#') ? lower.slice(1) : lower;
  return receipts.find((r) => r.invoiceNumber.trim().toLowerCase() === withoutHash);
}
