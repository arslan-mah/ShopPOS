import { Injectable, inject, signal } from '@angular/core';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { FIREBASE_AUTH } from '../firebase/firebase.tokens';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(FIREBASE_AUTH);

  /** True after the first auth state is resolved (session restore or signed-out). */
  readonly ready = signal(false);
  readonly user = signal<User | null>(null);

  constructor() {
    onAuthStateChanged(this.auth, (u) => {
      this.user.set(u);
      this.ready.set(true);
    });
  }

  /**
   * Resolves when the initial auth state has been restored from persistence.
   * Call this before Realtime Database / Firestore requests so `auth` is available to security rules.
   */
  waitForAuthReady(): Promise<void> {
    return this.auth.authStateReady();
  }

  /**
   * Ensures the signed-in user has a fresh ID token before Realtime Database runs.
   * Without this, RTDB can connect before auth is attached and rules see `auth` as null → permission_denied.
   */
  async ensureSessionForDatabase(): Promise<void> {
    await this.auth.authStateReady();
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to load this data.');
    }
    await user.getIdToken(true);
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
  }

  async signUp(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email.trim(), password);
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }
}
