import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router } from '@angular/router';
import { merge, of } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/theme/theme.service';

@Component({
  selector: 'app-shop-header',
  imports: [MatToolbarModule, MatButtonModule, MatIconModule],
  templateUrl: './shop-header.component.html',
  styleUrl: './shop-header.component.scss',
})
export class ShopHeaderComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  protected readonly user = this.auth.user;

  /** Page title derived from the current URL. */
  protected readonly pageTitle = toSignal(
    merge(
      of(this.router.url),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
      ),
    ).pipe(map((url) => this.titleFromUrl(url))),
    { initialValue: this.titleFromUrl(this.router.url) },
  );

  protected readonly pageSubtitle = toSignal(
    merge(
      of(this.router.url),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url),
      ),
    ).pipe(map((url) => this.subtitleFromUrl(url))),
    { initialValue: this.subtitleFromUrl(this.router.url) },
  );

  private titleFromUrl(url: string): string {
    if (url.includes('/dashboard')) return 'Dashboard';
    if (url.includes('/products')) return 'Products';
    if (url.includes('/customers')) return 'Customers';
    if (url.includes('/receipts')) return 'Receipts';
    if (url.includes('/home')) return 'Point of Sale';
    return 'My Shop';
  }

  private subtitleFromUrl(url: string): string {
    if (url.includes('/dashboard')) return 'Store overview and analytics';
    if (url.includes('/products')) return 'Manage your product catalog';
    if (url.includes('/customers')) return 'Manage your customers';
    if (url.includes('/receipts')) return 'View and search saved invoices';
    if (url.includes('/home')) return 'Point of sale — sell products and checkout';
    return '';
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
