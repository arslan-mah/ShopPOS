import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

const STORAGE_KEY = 'myshop-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  /** `true` when dark theme is active */
  readonly isDark = signal(this.readInitial());

  constructor() {
    this.syncDom(this.isDark());
  }

  /** Toggle between light and dark; preference is saved in localStorage. */
  toggle(): void {
    const next = !this.isDark();
    this.isDark.set(next);
    this.syncDom(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
  }

  private readInitial(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') {
        return true;
      }
      if (stored === 'light') {
        return false;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  }

  private syncDom(dark: boolean): void {
    this.doc.documentElement.classList.toggle('app-dark', dark);
  }
}
