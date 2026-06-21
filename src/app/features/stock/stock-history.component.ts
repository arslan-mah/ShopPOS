import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import { Product, ProductsService } from '../products/products.service';
import { StockMovement, StockMovementsService } from './stock-movements.service';

@Component({
  selector: 'app-stock-history',
  imports: [DatePipe, CardModule, ButtonModule, MessageModule, TagModule],
  templateUrl: './stock-history.component.html',
  styleUrl: './stock-history.component.scss',
})
export class StockHistoryComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly movementsService = inject(StockMovementsService);
  private readonly productsService = inject(ProductsService);

  readonly movements = signal<StockMovement[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly productFilter = signal('');

  readonly filteredMovements = computed(() => {
    const pid = this.productFilter();
    const all = this.movements();
    if (!pid) return all;
    return all.filter((m) => m.productId === pid);
  });

  readonly productMap = computed(() => new Map(this.products().map((p) => [p.id, p])));

  ngOnInit(): void {
    void this.subscribeWhenAuthReady();
  }

  private async subscribeWhenAuthReady(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }

    this.movementsService
      .watchMovements()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.movements.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });

    this.productsService
      .watchProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (rows) => this.products.set(rows) });
  }

  productName(m: StockMovement): string {
    return m.productName || this.productMap().get(m.productId)?.name || '—';
  }

  typeLabel(type: StockMovement['type']): string {
    const labels: Record<StockMovement['type'], string> = {
      sale: 'Sale',
      refund: 'Refund',
      purchase: 'Purchase',
      adjustment: 'Adjustment',
    };
    return labels[type] ?? type;
  }

  clearFilter(): void {
    this.productFilter.set('');
  }
}
