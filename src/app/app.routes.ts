import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { loginPageGuard } from './core/auth/login-page.guard';
import { roleGuard } from './core/auth/role.guard';
import { ReceiptsListComponent } from './features/receipts/receipts-list/receipts-list.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginPageGuard],
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shop-layout/shop-layout.component').then((m) => m.ShopLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'home',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'products',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/products/products.component').then((m) => m.ProductsComponent),
      },
      {
        path: 'customers',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/customers/customers.component').then((m) => m.CustomersComponent),
      },
      {
        path: 'customers/:id',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/customers/customer-detail.component').then((m) => m.CustomerDetailComponent),
      },
      {
        path: 'receipts',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        component: ReceiptsListComponent,
      },
      { path: 'receipts/list', redirectTo: 'receipts', pathMatch: 'full' },
      { path: 'receipts/:id', redirectTo: 'receipts', pathMatch: 'full' },
      {
        path: 'expenses',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () =>
          import('./features/expenses/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'suppliers',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/suppliers/suppliers.component').then((m) => m.SuppliersComponent),
      },
      {
        path: 'purchases',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/purchases/purchases.component').then((m) => m.PurchasesComponent),
      },
      {
        path: 'credit',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/credit/credit-ledger.component').then((m) => m.CreditLedgerComponent),
      },
      {
        path: 'stock-history',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'cashier'] },
        loadComponent: () =>
          import('./features/stock/stock-history.component').then((m) => m.StockHistoryComponent),
      },
      {
        path: 'settings',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'users',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () => import('./features/users/users.component').then((m) => m.UsersComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
