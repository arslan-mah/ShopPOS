export type UserRole = 'admin' | 'cashier';

export const USER_ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'cashier', label: 'Cashier' },
];

/** Route path segment (e.g. `dashboard`) → roles allowed. */
export const ROUTE_ACCESS: Record<string, UserRole[]> = {
  dashboard: ['admin'],
  home: ['admin', 'cashier'],
  products: ['admin', 'cashier'],
  purchases: ['admin', 'cashier'],
  customers: ['admin', 'cashier'],
  credit: ['admin', 'cashier'],
  receipts: ['admin', 'cashier'],
  expenses: ['admin'],
  suppliers: ['admin', 'cashier'],
  'stock-history': ['admin', 'cashier'],
  settings: ['admin'],
  users: ['admin'],
};

export function canRoleAccessRoute(role: UserRole | null, routeSegment: string): boolean {
  if (!role) return false;
  const allowed = ROUTE_ACCESS[routeSegment];
  return allowed ? allowed.includes(role) : false;
}

export function defaultLandingPath(role: UserRole | null): string {
  return role === 'cashier' ? '/home' : '/dashboard';
}
