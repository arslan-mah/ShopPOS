import { Component, input, output, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { BarcodeListenerComponent } from './barcode-listener.component';
import { BarcodeCameraDialogComponent } from './barcode-camera-dialog.component';

@Component({
  selector: 'app-barcode-scan-toolbar',
  standalone: true,
  imports: [BarcodeListenerComponent, BarcodeCameraDialogComponent, ButtonModule],
  template: `
    @if (enabled()) {
      <div class="scan-toolbar">
        <app-barcode-listener [enabled]="enabled()" [hint]="hint()" (codeScanned)="onCode($event)" />
        <p-button
          type="button"
          icon="pi pi-camera"
          label="Camera"
          size="small"
          [outlined]="true"
          severity="secondary"
          (onClick)="openCamera()"
        />
      </div>
    }
    <app-barcode-camera-dialog #camera (codeScanned)="onCode($event)" />
  `,
  styles: `
    .scan-toolbar {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }

    .scan-toolbar app-barcode-listener {
      flex: 1;
      min-width: 12rem;
    }
  `,
})
export class BarcodeScanToolbarComponent {
  readonly enabled = input(true);
  readonly hint = input('Scanner ready — scan barcode or QR');
  readonly codeScanned = output<string>();

  private readonly camera = viewChild(BarcodeCameraDialogComponent);

  onCode(code: string): void {
    const trimmed = code.trim();
    if (trimmed) this.codeScanned.emit(trimmed);
  }

  openCamera(): void {
    this.camera()?.open();
  }
}
