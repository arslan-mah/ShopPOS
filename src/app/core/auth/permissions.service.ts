import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { get, ref } from 'firebase/database';
import { REALTIME_DATABASE } from '../firebase/firebase.tokens';
import { AuthService } from './auth.service';
import { canRoleAccessRoute, defaultLandingPath, UserRole } from './roles';

export interface ShopUserProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly db = inject(REALTIME_DATABASE);
  private readonly auth = inject(AuthService);

  readonly profile = signal<ShopUserProfile | null>(null);
  /** True after profile sync finished for the current auth state. */
  readonly ready = signal(false);

  readonly role = computed(() => this.profile()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isCashier = computed(() => this.role() === 'cashier');

  constructor() {
    effect(() => {
      const authReady = this.auth.ready();
      const user = this.auth.user();
      if (!authReady) return;
      void this.syncProfile(user?.uid ?? null);
    });
  }

  hasRole(...roles: UserRole[]): boolean {
    const r = this.role();
    return r !== null && roles.includes(r);
  }

  canAccessRoute(routeSegment: string): boolean {
    return canRoleAccessRoute(this.role(), routeSegment);
  }

  defaultLandingPath(): string {
    return defaultLandingPath(this.role());
  }

  /** Call after sign-in; signs out and throws if profile missing or inactive. */
  async ensureAuthorized(): Promise<ShopUserProfile> {
    await this.auth.waitForAuthReady();
    const uid = this.auth.user()?.uid;
    if (!uid) {
      throw new Error('You must be signed in.');
    }
    const profile = await this.fetchProfile(uid);
    this.profile.set(profile);
    this.ready.set(true);
    if (!profile || !profile.active) {
      await this.auth.signOut();
      throw new Error(
        'Your account is not authorized for this shop. Ask an admin to add your user profile in Firebase.',
      );
    }
    return profile;
  }

  private async syncProfile(uid: string | null): Promise<void> {
    this.ready.set(false);
    if (!uid) {
      this.profile.set(null);
      this.ready.set(true);
      return;
    }
    try {
      await this.auth.waitForAuthReady();
      const profile = await this.fetchProfile(uid);
      this.profile.set(profile);
    } catch {
      this.profile.set(null);
    } finally {
      this.ready.set(true);
    }
  }

  private async fetchProfile(uid: string): Promise<ShopUserProfile | null> {
    await this.auth.waitForAuthReady();
    if (this.auth.user()) {
      await this.auth.ensureSessionForDatabase();
    }
    console.log('fetchProfile', uid);
    const snap = await get(ref(this.db, `users/${uid}`));
    if (!snap.exists()) return null;
    console.log('snap.val()', snap.val());
    return mapUserProfile(uid, snap.val() as Record<string, unknown>);
  }
}

function mapUserProfile(id: string, data: Record<string, unknown>): ShopUserProfile {
  const roleRaw = data['role'];
  const role: UserRole = roleRaw === 'cashier' ? 'cashier' : 'admin';
  return {
    id,
    email: typeof data['email'] === 'string' ? data['email'] : '',
    displayName: typeof data['displayName'] === 'string' ? data['displayName'] : '',
    role,
    active: data['active'] !== false,
    createdAt: parseCreatedAt(data['createdAt']),
  };
}

function parseCreatedAt(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return new Date(v);
  }
  return null;
}
