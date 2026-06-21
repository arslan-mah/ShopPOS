import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { loginPageGuard } from './core/auth/login-page.guard';
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
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'home',
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'products',
        loadComponent: () =>
          import('./features/products/products.component').then((m) => m.ProductsComponent),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./features/customers/customers.component').then((m) => m.CustomersComponent),
      },
      {
        path: 'customers/:id',
        loadComponent: () =>
          import('./features/customers/customer-detail.component').then((m) => m.CustomerDetailComponent),
      },
      {
        path: 'receipts',
        component: ReceiptsListComponent,
      },
      { path: 'receipts/list', redirectTo: 'receipts', pathMatch: 'full' },
      { path: 'receipts/:id', redirectTo: 'receipts', pathMatch: 'full' },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./features/expenses/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'suppliers',
        loadComponent: () =>
          import('./features/suppliers/suppliers.component').then((m) => m.SuppliersComponent),
      },
      {
        path: 'purchases',
        loadComponent: () =>
          import('./features/purchases/purchases.component').then((m) => m.PurchasesComponent),
      },
      {
        path: 'credit',
        loadComponent: () =>
          import('./features/credit/credit-ledger.component').then((m) => m.CreditLedgerComponent),
      },
      {
        path: 'stock-history',
        loadComponent: () =>
          import('./features/stock/stock-history.component').then((m) => m.StockHistoryComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '/dashboard' },
];
