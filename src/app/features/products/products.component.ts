import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, OnInit, signal } from '@angular/core';
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
  productInventoryValue,
  StockInputMode,
  stockQuantityToBase,
} from './products.service';
import { findProductByBarcode } from '../../shared/barcode/barcode.util';
import {
  isProductExpired,
  isProductExpiringSoon,
  productExpiryTagLabel,
  productExpiryTagSeverity,
} from './product-expiry.util';
import { BarcodeScanToolbarComponent } from '../../shared/barcode/barcode-scan-toolbar.component';

/** Count products: price entered per piece or per carton. */
export type CountPriceMode = 'piece' | 'carton';

/** Low-stock threshold input: weight/volume use base/selling; count uses cartons or pieces. */
type LowStockInputMode = StockInputMode | 'carton';

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
    BarcodeScanToolbarComponent,
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
  private lastLowStockMode: LowStockInputMode = 'base';

  readonly items = signal<Product[]>([]);
  readonly searchQuery = signal('');
  readonly filteredItems = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const rows = this.items();
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode?.toLowerCase().includes(q) ?? false),
    );
  });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Single modal for add + edit */
  showProductModal = false;
  readonly editingProduct = signal<Product | null>(null);
  readonly openMenuId = signal<string | null>(null);

  readonly isEditMode = computed(() => this.editingProduct() !== null);

  readonly productScanEnabled = computed(() => !this.showProductModal && !this.saving());

  readonly unitTypes: { value: ProductUnitType; label: string }[] = [
    { value: 'weight', label: 'Weight (g / kg)' },
    { value: 'volume', label: 'Volume (ml / L)' },
    { value: 'count', label: 'Count (cartons of pieces)' },
  ];

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    barcode: ['', [Validators.maxLength(100)]],
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
    lowStockInputMode: this.fb.nonNullable.control<LowStockInputMode>('base'),
    lowStockQuantity: [0, [Validators.required, Validators.min(0)]],
    hasExpiry: [false],
    expiryDate: [''],
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
  lowStockModeOptionsForForm(): { value: LowStockInputMode; label: string }[] {
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

  inventoryValue(p: Product): number {
    return productInventoryValue(p);
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

  async saveProduct(): Promise<void> {
    const editing = this.editingProduct();
    const draft = this.buildDraftFromForm(editing?.stockInBaseUnit);
    if (!draft) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.ensureSessionForDatabase();
      if (editing) {
        await this.productsService.updateProduct(editing.id, draft);
      } else {
        await this.productsService.addProduct(draft);
      }
      this.closeProductModal();
    } catch (err: unknown) {
      this.error.set(mapDataErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private buildDraftFromForm(existingStockInBase?: number): ProductDraft | null {
    if (this.form.invalid) {
      return null;
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
      stockInBaseUnit =
        existingStockInBase !== undefined ? existingStockInBase : v.cartonsInStock * ppc;
      pricePerPiece =
        v.countPriceMode === 'piece' ? v.countPriceAmount : v.countPriceAmount / ppc;
      pricePerUnit = 0;
      baseUnit = 'pc';
      sellingUnit = 'carton';
      conversionFactor = ppc;
    } else {
      stockInBaseUnit =
        existingStockInBase !== undefined
          ? existingStockInBase
          : stockQuantityToBase({
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

    return {
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
      barcode: v.barcode.trim() || undefined,
    };
  }

  openAddProduct(): void {
    this.editingProduct.set(null);
    this.form.reset({
      name: '',
      barcode: '',
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
    this.showProductModal = true;
  }

  openEditProduct(p: Product): void {
    this.closeRowMenu();
    this.editingProduct.set(p);
    const ppc = Math.max(1, p.piecesPerCarton);
    const lowMode = this.lowStockModeForProduct(p);

    if (p.type === 'count') {
      this.form.patchValue({
        name: p.name,
        barcode: p.barcode ?? '',
        type: p.type,
        baseUnit: p.baseUnit,
        sellingUnit: p.sellingUnit,
        conversionFactor: p.conversionFactor,
        piecesPerCarton: ppc,
        cartonsInStock: p.stockInBaseUnit / ppc,
        countPriceMode: 'piece',
        countPriceAmount: p.pricePerPiece,
        cost: p.cost,
        lowStockInputMode: lowMode,
        lowStockQuantity: baseStockToDisplayQuantity(
          p.lowStockThreshold,
          p.type,
          p.conversionFactor,
          ppc,
          lowMode,
        ),
        hasExpiry: p.hasExpiry,
        expiryDate: p.expiryDate ?? '',
      });
    } else {
      const stockMode: StockInputMode = 'selling';
      this.form.patchValue({
        name: p.name,
        barcode: p.barcode ?? '',
        type: p.type,
        baseUnit: p.baseUnit,
        sellingUnit: p.sellingUnit,
        conversionFactor: p.conversionFactor,
        pricePerUnit: p.pricePerUnit,
        cost: p.cost,
        stockInputMode: stockMode,
        stockQuantity: baseStockToDisplayQuantity(
          p.stockInBaseUnit,
          p.type,
          p.conversionFactor,
          ppc,
          stockMode,
        ),
        lowStockInputMode: lowMode,
        lowStockQuantity: baseStockToDisplayQuantity(
          p.lowStockThreshold,
          p.type,
          p.conversionFactor,
          ppc,
          lowMode,
        ),
        hasExpiry: p.hasExpiry,
        expiryDate: p.expiryDate ?? '',
      });
    }

    this.lastLowStockMode = this.form.controls.lowStockInputMode.value;
    this.showProductModal = true;
  }

  closeProductModal(): void {
    this.showProductModal = false;
    this.editingProduct.set(null);
  }

  private lowStockModeForProduct(p: Product): LowStockInputMode {
    if (p.type === 'count') {
      const ppc = Math.max(1, p.piecesPerCarton);
      const asCartons = p.lowStockThreshold / ppc;
      return asCartons >= 1 && Math.abs(asCartons - Math.round(asCartons)) < 0.001
        ? 'carton'
        : 'base';
    }
    return 'selling';
  }

  toggleRowMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  closeRowMenu(): void {
    this.openMenuId.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeRowMenu();
  }

  expiryLabel(p: Product): string {
    return productExpiryTagLabel(p);
  }

  expirySeverity(p: Product): 'danger' | 'warn' | 'info' {
    return productExpiryTagSeverity(p);
  }

  isExpired(p: Product): boolean {
    return isProductExpired(p);
  }

  isExpiringSoon(p: Product): boolean {
    return isProductExpiringSoon(p);
  }

  onProductBarcodeScanned(code: string): void {
    const existing = findProductByBarcode(this.items(), code);
    if (existing) {
      this.openEditProduct(existing);
      return;
    }
    this.openAddProductWithBarcode(code);
  }

  openAddProductWithBarcode(code: string): void {
    this.openAddProduct();
    this.form.patchValue({ barcode: code.trim() });
  }

  async deleteProduct(id: string, name: string): Promise<void> {
    this.closeRowMenu();
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

  baseUnitBadge(p: Product): string {
    return p.type === 'count' ? 'PIECES' : p.baseUnit.toUpperCase();
  }

  sellingUnitBadge(p: Product): string {
    return p.sellingUnit.toUpperCase();
  }

  priceMainValue(p: Product): string {
    if (p.type === 'count') {
      const ppc = Math.max(1, p.piecesPerCarton);
      return (p.pricePerPiece * ppc).toFixed(2);
    }
    return p.pricePerUnit.toFixed(2);
  }

  priceMainUnit(p: Product): string {
    return p.sellingUnit;
  }

  priceSubLine(p: Product): string | null {
    if (p.type === 'count') {
      return `${p.pricePerPiece.toFixed(2)} / pc`;
    }
    return null;
  }

  costValue(p: Product): string {
    if (p.cost <= 0) return '—';
    return p.cost.toFixed(2);
  }

  costUnit(p: Product): string {
    if (p.cost <= 0) return '';
    return p.type === 'count' ? 'pc' : p.sellingUnit;
  }

}
