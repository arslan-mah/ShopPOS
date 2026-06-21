import {
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { Html5Qrcode } from 'html5-qrcode';

@Component({
  selector: 'app-barcode-camera-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule],
  template: `
    <p-dialog
      header="Camera scan"
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [closable]="true"
      [appendTo]="'body'"
      [style]="{ width: '28rem', maxWidth: '96vw' }"
      (onShow)="onDialogShow()"
      (onHide)="close()"
    >
      <p class="hint">Point the camera at a barcode or receipt QR code.</p>
      <div [id]="readerId" #readerHost class="reader"></div>
      @if (cameraError()) {
        <p class="err">{{ cameraError() }}</p>
      }
      <div class="actions">
        <p-button type="button" label="Close" severity="secondary" [outlined]="true" (onClick)="close()" />
      </div>
    </p-dialog>
  `,
  styles: `
    .hint {
      margin: 0 0 0.75rem;
      font-size: 0.88rem;
      color: var(--app-muted, #64748b);
    }

    .reader {
      width: 100%;
      min-height: 280px;
      border-radius: 8px;
      overflow: hidden;
      background: #0f172a;
    }

    .reader :global(video) {
      border-radius: 8px;
    }

    .err {
      margin: 0.75rem 0 0;
      color: #c0392b;
      font-size: 0.85rem;
      line-height: 1.45;
    }

    .actions {
      margin-top: 0.75rem;
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class BarcodeCameraDialogComponent implements OnDestroy {
  readonly visible = signal(false);
  readonly cameraError = signal<string | null>(null);
  readonly codeScanned = output<string>();

  readonly readerId = `barcode-reader-${Math.random().toString(36).slice(2, 11)}`;
  private readonly readerHost = viewChild<ElementRef<HTMLDivElement>>('readerHost');

  private scanner: Html5Qrcode | null = null;
  private starting = false;

  open(): void {
    this.cameraError.set(null);
    this.visible.set(true);
  }

  close(): void {
    this.visible.set(false);
    void this.stopCamera();
  }

  onVisibleChange(v: boolean): void {
    this.visible.set(v);
    if (!v) void this.stopCamera();
  }

  onDialogShow(): void {
    // Wait for dialog layout + overlay before attaching camera stream.
    requestAnimationFrame(() => {
      setTimeout(() => void this.startCamera(), 200);
    });
  }

  ngOnDestroy(): void {
    void this.stopCamera();
  }

  private async startCamera(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.stopCamera();
    this.cameraError.set(null);

    const host = this.readerHost()?.nativeElement;
    if (!host) {
      this.cameraError.set('Camera view is not ready. Close and try again.');
      this.starting = false;
      return;
    }

    if (!window.isSecureContext) {
      this.cameraError.set(
        'Camera requires HTTPS or localhost. Open the app via https:// or http://localhost, not a plain LAN IP.',
      );
      this.starting = false;
      return;
    }

    try {
      this.scanner = new Html5Qrcode(this.readerId);
      const cameraId = await this.pickCameraId();
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      const onScan = (decoded: string) => {
        this.codeScanned.emit(decoded.trim());
        this.close();
      };

      if (cameraId) {
        await this.scanner.start(cameraId, config, onScan, () => {});
      } else {
        await this.scanner.start({ facingMode: 'environment' }, config, onScan, () => {});
      }
    } catch (e: unknown) {
      this.cameraError.set(this.formatCameraError(e));
    } finally {
      this.starting = false;
    }
  }

  private async pickCameraId(): Promise<string | { facingMode: string } | null> {
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras.length) {
        return { facingMode: 'environment' };
      }
      const back = cameras.find((c) => /back|rear|environment/i.test(c.label));
      if (back) return back.id;
      return cameras[0].id;
    } catch {
      return { facingMode: 'environment' };
    }
  }

  private formatCameraError(e: unknown): string {
    if (e instanceof DOMException) {
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        return 'Camera permission denied. Allow camera access in your browser site settings, then reload and try again.';
      }
      if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        return 'No camera found on this device. Use a USB barcode scanner instead.';
      }
      if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        return 'Camera is in use by another app. Close other apps using the camera and try again.';
      }
      return e.message || 'Could not start camera.';
    }
    if (e instanceof Error) {
      const msg = e.message.toLowerCase();
      if (msg.includes('permission') || msg.includes('not allowed')) {
        return 'Camera permission denied. Allow camera in browser settings, reload, and try again.';
      }
      if (msg.includes('not supported') || msg.includes('secure')) {
        return 'Camera is not available in this context. Use HTTPS or localhost.';
      }
      return e.message;
    }
    return 'Could not access camera. Allow permission in the browser or use a USB scanner.';
  }

  private async stopCamera(): Promise<void> {
    if (!this.scanner) return;
    const scanner = this.scanner;
    this.scanner = null;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      /* ignore stop races */
    }
  }
}
