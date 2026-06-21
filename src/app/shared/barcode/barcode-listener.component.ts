import {
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  viewChild,
  effect,
} from '@angular/core';

/**
 * Captures USB barcode-scanner input (keyboard wedge).
 * Keep focus on the hidden field while `enabled` is true.
 */
@Component({
  selector: 'app-barcode-listener',
  standalone: true,
  template: `
    @if (enabled()) {
      <div class="scan-strip" [class.pulse]="ready()">
        <span class="scan-dot" aria-hidden="true"></span>
        <span>{{ hint() }}</span>
      </div>
      <input
        #capture
        class="capture-input"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        [attr.aria-label]="hint()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()"
      />
    }
  `,
  styles: `
    .scan-strip {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      margin-bottom: 0.65rem;
      border-radius: 8px;
      border: 1px dashed var(--app-border, #cbd5e1);
      background: color-mix(in srgb, var(--p-primary-color, #0ea5e9) 8%, transparent);
      font-size: 0.82rem;
      color: var(--app-muted, #64748b);
    }

    .scan-strip.pulse .scan-dot {
      animation: pulse 1.4s ease-in-out infinite;
    }

    .scan-dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }

    .capture-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `,
})
export class BarcodeListenerComponent {
  readonly enabled = input(true);
  readonly hint = input('Scanner ready — scan barcode or QR');
  readonly ready = input(true);
  readonly codeScanned = output<string>();

  private readonly captureRef = viewChild<ElementRef<HTMLInputElement>>('capture');

  constructor() {
    effect(() => {
      if (this.enabled()) {
        queueMicrotask(() => this.focusCapture());
      }
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.enabled()) {
      queueMicrotask(() => this.focusCapture());
    }
  }

  onBlur(): void {
    if (this.enabled()) {
      setTimeout(() => this.focusCapture(), 120);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const el = this.captureRef()?.nativeElement;
      const value = el?.value.trim() ?? '';
      if (value) {
        this.codeScanned.emit(value);
      }
      if (el) {
        el.value = '';
      }
      queueMicrotask(() => this.focusCapture());
    }
  }

  focusCapture(): void {
    if (!this.enabled()) return;
    const el = this.captureRef()?.nativeElement;
    if (!el) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      if (active !== el && !active.classList.contains('capture-input')) {
        return;
      }
    }
    el.focus();
  }
}
