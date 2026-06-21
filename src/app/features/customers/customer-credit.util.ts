import { Receipt } from '../receipts/receipts.service';

export function receiptBelongsToCustomer(r: Receipt, customerId: string): boolean {
  const c = r.customer;
  return c.mode === 'registered' && c.customerId === customerId;
}

export function customerOutstandingCredit(receipts: Receipt[], customerId: string): number {
  return receipts
    .filter((r) => r.type === 'sale' && receiptBelongsToCustomer(r, customerId))
    .reduce((sum, r) => sum + Math.max(0, r.totals.remainingAmount), 0);
}

export function customerReceipts(receipts: Receipt[], customerId: string): Receipt[] {
  return receipts
    .filter((r) => receiptBelongsToCustomer(r, customerId))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export function outstandingCreditByCustomerId(receipts: Receipt[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of receipts) {
    if (r.type !== 'sale' || r.customer.mode !== 'registered') continue;
    const id = r.customer.customerId;
    if (!id) continue;
    const remaining = Math.max(0, r.totals.remainingAmount);
    if (remaining <= 0) continue;
    map.set(id, (map.get(id) ?? 0) + remaining);
  }
  return map;
}
