import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../core/auth/auth.service';
import { mapDataErrorMessage } from '../../core/firebase/map-data-error-message';
import {
  baseStockToDisplayQuantity,
  Product,
  ProductDraft,
  ProductUnitType,
  ProductsService,
  StockInputMode,
  stockQuantityToBase,
} from './products.service';

/** Count products: price entered per piece or per carton. */
export type CountPriceMode = 'piece' | 'carton';

/** Adjust panel: weight/volume use base/selling; count uses cartons or pieces. */
export type AdjustStockMode = StockInputMode | 'carton';

@Component({
  selector: 'app-products',
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    DatePipe,
    CardModule,
    ButtonModule,
    DialogModule,
    MessageModule,
    TagModule,
  ],
  templateUrl: './products.component.html',
  styleUrl: './products.component.scss',
})
export class ProductsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly productsService = inject(ProductsService);
  /** Tracks previous low-stock unit for converting quantity when the unit changes. */
  private lastLowStockMode: AdjustStockMode = 'base';

  readonly items = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savingAdjustId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly adjustingId = signal<string | null>(null);

  /** Controls the Add Product dialog visibility */
  showAddProductModal = false;

  readonly unitTypes: { value: ProductUnitType; label: string }[] = [
    { value: 'weight', label: 'Weight (g / kg)' },
    { value: 'volume', label: 'Volume (ml / L)' },
    { value: 'count', label: 'Count (cartons of pieces)' },
  ];

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    type: this.fb.nonNullable.control<ProductUnitType>('weight', [Validators.required]),
    baseUnit: ['g', [Validators.required, Validators.maxLength(20)]],
    sellingUnit: ['kg', [Validators.required, Validators.maxLength(20)]],
    conversionFactor: [1000, [Validators.required, Validators.min(0.0000001)]],
    pricePerUnit: [0, [Validators.required, Validators.min(0)]],
    /** Purchase cost: per piece (count) or per selling unit (weight/volume). */
    cost: [0, [Validators.min(0)]],
    piecesPerCarton: [10, [Validators.required, Validators.min(1)]],
    cartonsInStock: [0, [Validators.required, Validators.min(0)]],
    countPriceMode: this.fb.nonNullable.control<CountPriceMode>('piece'),
    countPriceAmount: [0, [Validators.required, Validators.min(0)]],
    stockInputMode: this.fb.nonNullable.control<StockInputMode>('base'),
    stockQuantity: [0, [Validators.required, Validators.min(0)]],
    /** Unit for low-stock threshold input; value is converted to base units for storage. */
    lowStockInputMode: this.fb.nonNullable.control<AdjustStockMode>('base'),
    lowStockQuantity: [0, [Validators.required, Validators.min(0)]],
    hasExpiry: [false],
    expiryDate: [''],
  });

  readonly adjustForm = this.fb.nonNullable.group({
    stockInputMode: this.fb.nonNullable.control<AdjustStockMode>('base'),
    stockQuantity: [0, [Validators.required, Validators.min(0)]],
  });

  ngOnInit(): void {
    this.lastLowStockMode = this.form.controls.lowStockInputMode.value;
    void this.subscribeWhenAuthReady();

    this.form.controls.hasExpiry.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((has) => {
        const exp = this.form.controls.expiryDate;
        if (has) {
          exp.setValidators([Validators.required]);
        } else {
          exp.clearValidators();
          exp.setValue('');
        }
        exp.updateValueAndValidity({ emitEvent: false });
      });

    this.form.controls.type.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.form.patchValue(
        { stockInputMode: 'base', lowStockInputMode: 'base', lowStockQuantity: 0 },
        { emitEvent: false },
      );
      this.lastLowStockMode = 'base';
    });

    this.form.controls.lowStockInputMode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((nextMode) => {
      const prevMode = this.lastLowStockMode;
      this.lastLowStockMode = nextMode;
      if (prevMode === nextMode) {
        return;
      }
      const v = this.form.getRawValue();
      const ppc = v.type === 'count' ? Math.max(1, v.piecesPerCarton || 1) : 1;
      const qty = v.lowStockQuantity;
      const base = stockQuantityToBase({
        type: v.type,
        conversionFactor: v.conversionFactor,
        piecesPerCarton: ppc,
        mode: prevMode,
        quantity: qty,
      });
      const newQty = baseStockToDisplayQuantity(base, v.type, v.conversionFactor, ppc, nextMode);
      this.form.patchValue({ lowStockQuantity: newQty }, { emitEvent: false });
    });

    this.form.controls.piecesPerCarton.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.form.getRawValue().type === 'count') {
          const ppc = Math.max(1, this.form.controls.piecesPerCarton.value || 1);
          this.form.patchValue({ conversionFactor: ppc }, { emitEvent: false });
        }
      });
  }

  previewStockInBase(): number {
    const v = this.form.getRawValue();
    if (v.type === 'count') {
      const ppc = Math.max(1, v.piecesPerCarton);
      return v.cartonsInStock * ppc;
    }
    return stockQuantityToBase({
      type: v.type,
      conversionFactor: v.conversionFactor,
      piecesPerCarton: 1,
      mode: v.stockInputMode,
      quantity: v.stockQuantity,
    });
  }

  /** Weight/volume: same stock expressed in the selling unit (e.g. kg, L). */
  previewStockInSelling(): number {
    const v = this.form.getRawValue();
    if (v.type !== 'weight' && v.type !== 'volume') {
      return 0;
    }
    const base = this.previewStockInBase();
    const cf = v.conversionFactor > 0 ? v.conversionFactor : 1;
    return base / cf;
  }

  /** Piece price from count price inputs. */
  previewPricePerPiece(): number {
    const v = this.form.getRawValue();
    if (v.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, v.piecesPerCarton);
    const amt = v.countPriceAmount;
    return v.countPriceMode === 'piece' ? amt : amt / ppc;
  }

  previewPricePerCarton(): number {
    const v = this.form.getRawValue();
    if (v.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, v.piecesPerCarton);
    const piece = this.previewPricePerPiece();
    return piece * ppc;
  }

  stockModeOptionsForForm(): { value: StockInputMode; label: string }[] {
    const v = this.form.getRawValue();
    return [
      { value: 'base', label: `In ${v.baseUnit} (base)` },
      { value: 'selling', label: `In ${v.sellingUnit} (selling)` },
    ];
  }

  /** Low-stock threshold unit options (same basis as stock conversion). */
  lowStockModeOptionsForForm(): { value: AdjustStockMode; label: string }[] {
    const v = this.form.getRawValue();
    if (v.type === 'count') {
      const ppc = Math.max(1, v.piecesPerCarton || 1);
      return [
        { value: 'carton', label: `Cartons (${ppc} pc each)` },
        { value: 'base', label: 'Pieces' },
      ];
    }
    return [
      { value: 'base', label: `Base (${v.baseUnit})` },
      { value: 'selling', label: `Selling (${v.sellingUnit})` },
    ];
  }

  /** Stored low-stock threshold in base units from current form inputs. */
  previewLowStockInBase(): number {
    const v = this.form.getRawValue();
    const ppc = v.type === 'count' ? Math.max(1, v.piecesPerCarton || 1) : 1;
    return stockQuantityToBase({
      type: v.type,
      conversionFactor: v.conversionFactor,
      piecesPerCarton: ppc,
      mode: v.lowStockInputMode,
      quantity: v.lowStockQuantity,
    });
  }

  /** Same low-stock threshold in selling unit (weight/volume). */
  previewLowStockInSelling(): number {
    const v = this.form.getRawValue();
    if (v.type !== 'weight' && v.type !== 'volume') {
      return 0;
    }
    const base = this.previewLowStockInBase();
    const cf = v.conversionFactor > 0 ? v.conversionFactor : 1;
    return base / cf;
  }

  /** Same low-stock threshold in cartons (count). */
  previewLowStockCartons(): number {
    const v = this.form.getRawValue();
    if (v.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, v.piecesPerCarton || 1);
    return this.previewLowStockInBase() / ppc;
  }

  stockModeOptionsForProduct(p: Product): { value: AdjustStockMode; label: string }[] {
    if (p.type === 'count') {
      const ppc = p.piecesPerCarton || 1;
      return [
        { value: 'carton', label: `Cartons (${ppc} pc each)` },
        { value: 'base', label: 'Total pieces' },
      ];
    }
    return [
      { value: 'base', label: `Base (${p.baseUnit})` },
      { value: 'selling', label: `Selling (${p.sellingUnit})` },
    ];
  }

  previewAdjustStock(p: Product): number {
    const v = this.adjustForm.getRawValue();
    return stockQuantityToBase({
      type: p.type,
      conversionFactor: p.conversionFactor,
      piecesPerCarton: p.piecesPerCarton,
      mode: v.stockInputMode,
      quantity: v.stockQuantity,
    });
  }

  /** Adjust preview: stock in selling unit (kg, L, …). */
  previewAdjustStockSelling(p: Product): number {
    if (p.type !== 'weight' && p.type !== 'volume') {
      return 0;
    }
    const base = this.previewAdjustStock(p);
    const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
    return base / cf;
  }

  /** Adjust preview: stock in cartons (count). */
  previewAdjustStockCartons(p: Product): number {
    if (p.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, p.piecesPerCarton);
    return this.previewAdjustStock(p) / ppc;
  }

  /** Table: stock in selling unit from stored base units. */
  stockInSellingUnit(p: Product): number {
    if (p.type !== 'weight' && p.type !== 'volume') {
      return 0;
    }
    const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
    return p.stockInBaseUnit / cf;
  }

  /** Table: stock in cartons from stored pieces. */
  stockInCartons(p: Product): number {
    if (p.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, p.piecesPerCarton);
    return p.stockInBaseUnit / ppc;
  }

  /** Table: low-stock alert threshold in selling unit (kg, L, …). */
  lowStockInSellingUnit(p: Product): number {
    if (p.type !== 'weight' && p.type !== 'volume') {
      return 0;
    }
    const cf = p.conversionFactor > 0 ? p.conversionFactor : 1;
    return p.lowStockThreshold / cf;
  }

  /** Table: low-stock alert threshold in cartons. */
  lowStockInCartons(p: Product): number {
    if (p.type !== 'count') {
      return 0;
    }
    const ppc = Math.max(1, p.piecesPerCarton);
    return p.lowStockThreshold / ppc;
  }

  applyUnitTypePreset(): void {
    const t = this.form.getRawValue().type;
    if (t === 'weight') {
      this.form.patchValue(
        {
          baseUnit: 'g',
          sellingUnit: 'kg',
          conversionFactor: 1000,
          stockInputMode: 'base',
          lowStockInputMode: 'base',
          lowStockQuantity: 0,
        },
        { emitEvent: false },
      );
      this.lastLowStockMode = 'base';
    } else if (t === 'volume') {
      this.form.patchValue(
        {
          baseUnit: 'ml',
          sellingUnit: 'L',
          conversionFactor: 1000,
          stockInputMode: 'base',
          lowStockInputMode: 'base',
          lowStockQuantity: 0,
        },
        { emitEvent: false },
      );
      this.lastLowStockMode = 'base';
    } else {
      const ppc = 10;
      this.form.patchValue(
        {
          baseUnit: 'pc',
          sellingUnit: 'carton',
          conversionFactor: ppc,
          piecesPerCarton: ppc,
          cartonsInStock: 0,
          countPriceMode: 'piece',
          stockInputMode: 'base',
          lowStockInputMode: 'base',
          lowStockQuantity: 0,
        },
        { emitEvent: false },
      );
      this.lastLowStockMode = 'base';
    }
  }

  openAdjustStock(p: Product): void {
    this.adjustingId.set(p.id);
    if (p.type === 'count') {
      this.adjustForm.setValue({
        stockInputMode: 'carton',
        stockQuantity: baseStockToDisplayQuantity(
          p.stockInBaseUnit,
          p.type,
          p.conversionFactor,
          p.piecesPerCarton,
          'carton',
        ),
      });
    } else {
      this.adjustForm.setValue({
        stockInputMode: 'base',
        stockQuantity: baseStockToDisplayQuantity(
          p.stockInBaseUnit,
          p.type,
          p.conversionFactor,
          p.piecesPerCarton,
          'base',
        ),
      });
    }
  }

  onAdjustModeChanged(p: Product): void {
    const mode = this.adjustForm.getRawValue().stockInputMode;
    this.adjustForm.patchValue(
      {
        stockQuantity: baseStockToDisplayQuantity(
          p.stockInBaseUnit,
          p.type,
          p.conversionFactor,
          p.piecesPerCarton,
          mode,
        ),
      },
      { emitEvent: false },
    );
  }

  cancelAdjustStock(): void {
    this.adjustingId.set(null);
  }

  async saveAdjustStock(p: Product): Promise<void> {
    if (this.adjustForm.invalid) {
      this.adjustForm.markAllAsTouched();
      return;
    }
    const { stockInputMode, stockQuantity } = this.adjustForm.getRawValue();
    const stockInBaseUnit = stockQuantityToBase({
      type: p.type,
      conversionFactor: p.conversionFactor,
      piecesPerCarton: p.piecesPerCarton,
      mode: stockInputMode,
      quantity: stockQuantity,
    });

    this.savingAdjustId.set(p.id);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.productsService.updateStock(p.id, stockInBaseUnit);
      this.adjustingId.set(null);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.savingAdjustId.set(null);
    }
  }

  private async subscribeWhenAuthReady(): Promise<void> {
    try {
      await this.auth.ensureSessionForDatabase();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Authentication required.');
      this.loading.set(false);
      return;
    }
    this.productsService
      .watchProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.items.set(rows);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(mapDataErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  async addProduct(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const ppc = v.type === 'count' ? Math.max(1, v.piecesPerCarton) : 1;

    let stockInBaseUnit: number;
    let pricePerUnit: number;
    let pricePerPiece: number;
    let baseUnit: string;
    let sellingUnit: string;
    let conversionFactor: number;

    if (v.type === 'count') {
      stockInBaseUnit = v.cartonsInStock * ppc;
      pricePerPiece =
        v.countPriceMode === 'piece' ? v.countPriceAmount : v.countPriceAmount / ppc;
      pricePerUnit = 0;
      baseUnit = 'pc';
      sellingUnit = 'carton';
      conversionFactor = ppc;
    } else {
      stockInBaseUnit = stockQuantityToBase({
        type: v.type,
        conversionFactor: v.conversionFactor,
        piecesPerCarton: 1,
        mode: v.stockInputMode,
        quantity: v.stockQuantity,
      });
      pricePerUnit = v.pricePerUnit;
      pricePerPiece = 0;
      baseUnit = v.baseUnit;
      sellingUnit = v.sellingUnit;
      conversionFactor = v.conversionFactor;
    }

    const lowStockThreshold = stockQuantityToBase({
      type: v.type,
      conversionFactor: v.type === 'count' ? ppc : v.conversionFactor,
      piecesPerCarton: ppc,
      mode: v.lowStockInputMode,
      quantity: v.lowStockQuantity,
    });

    const draft: ProductDraft = {
      name: v.name,
      type: v.type,
      baseUnit,
      sellingUnit,
      conversionFactor,
      pricePerUnit,
      pricePerPiece,
      cost: v.cost >= 0 ? v.cost : 0,
      stockInBaseUnit,
      lowStockThreshold,
      piecesPerCarton: v.type === 'count' ? ppc : 1,
      hasExpiry: v.hasExpiry,
      expiryDate: v.hasExpiry && v.expiryDate ? v.expiryDate : null,
    };

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.productsService.addProduct(draft);
      this.showAddProductModal = false;
      this.form.reset({
        name: '',
        type: 'weight',
        baseUnit: 'g',
        sellingUnit: 'kg',
        conversionFactor: 1000,
        pricePerUnit: 0,
        cost: 0,
        piecesPerCarton: 10,
        cartonsInStock: 0,
        countPriceMode: 'piece',
        countPriceAmount: 0,
        stockInputMode: 'base',
        stockQuantity: 0,
        lowStockInputMode: 'base',
        lowStockQuantity: 0,
        hasExpiry: false,
        expiryDate: '',
      });
      this.lastLowStockMode = this.form.controls.lowStockInputMode.value;
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  onModalClosed(): void {
    this.showAddProductModal = false;
  }

  async deleteProduct(id: string, name: string): Promise<void> {
    if (!confirm(`Delete product "${name}"?`)) {
      return;
    }
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      await this.productsService.deleteProduct(id);
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    }
  }

  isLowStock(p: Product): boolean {
    return p.lowStockThreshold > 0 && p.stockInBaseUnit <= p.lowStockThreshold;
  }

  formatUnits(p: Product): string {
    if (p.type === 'count') {
      return `${p.piecesPerCarton} pieces per carton`;
    }
    return `${p.baseUnit} → ${p.sellingUnit} (×${p.conversionFactor})`;
  }

  /** Cost label for table: same basis as stored `cost`. */
  costLine(p: Product): string {
    if (p.cost <= 0) {
      return '—';
    }
    if (p.type === 'count') {
      return `${p.cost.toFixed(2)} / pc`;
    }
    return `${p.cost.toFixed(2)} / ${p.sellingUnit}`;
  }

  priceLineCount(p: Product): string {
    const ppc = Math.max(1, p.piecesPerCarton);
    const perPc = p.pricePerPiece;
    const perCarton = perPc * ppc;
    return `${perPc.toFixed(2)} / pc · ${perCarton.toFixed(2)} / carton`;
  }

}
