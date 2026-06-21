import type { Product } from './products.service';

export function isProductExpired(p: Product, on = new Date()): boolean {
  if (!p.hasExpiry || !p.expiryDate) return false;
  const exp = parseExpiryDate(p.expiryDate);
  if (!exp) return false;
  const today = startOfDay(on);
  return exp < today;
}

export function isProductExpiringSoon(p: Product, withinDays = 7, on = new Date()): boolean {
  if (!p.hasExpiry || !p.expiryDate || isProductExpired(p, on)) return false;
  const exp = parseExpiryDate(p.expiryDate);
  if (!exp) return false;
  const limit = startOfDay(on);
  limit.setDate(limit.getDate() + withinDays);
  return exp <= limit;
}

export function productExpiryTagSeverity(p: Product): 'danger' | 'warn' | 'info' {
  if (isProductExpired(p)) return 'danger';
  if (isProductExpiringSoon(p)) return 'warn';
  return 'info';
}

export function productExpiryTagLabel(p: Product): string {
  if (!p.hasExpiry || !p.expiryDate) return '';
  if (isProductExpired(p)) return 'Expired';
  if (isProductExpiringSoon(p)) return 'Expiring soon';
  return formatExpiryDisplay(p.expiryDate);
}

function parseExpiryDate(value: string): Date | null {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatExpiryDisplay(value: string): string {
  const exp = parseExpiryDate(value);
  if (!exp) return value;
  return exp.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}
