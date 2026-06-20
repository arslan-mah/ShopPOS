import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { loginPageGuard } from './core/auth/login-page.guard';
import { ReceiptsComponent } from './features/receipts/receipts.component';
import { ReceiptsListComponent } from './features/receipts/receipts-list/receipts-list.component';
import { ReceiptsDetailComponent } from './features/receipts/receipts-detail/receipts-detail.component';

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
      { path: '', pathMatch: 'full', redirectTo: 'home' },
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
        path: 'receipts',
        component: ReceiptsComponent,
      },
      {
        path: 'receipts/list',
        component: ReceiptsListComponent,
      },
      {
        path: 'receipts/:id',
        component: ReceiptsDetailComponent,
      },
    ],
  },
  { path: '**', redirectTo: '/home' },
];
