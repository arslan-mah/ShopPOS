import { inject, Injectable } from '@angular/core';
import { onValue, orderByChild, query, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';
import { ShopUserProfile } from '../../core/auth/permissions.service';
import { UserRole } from '../../core/auth/roles';

export interface ShopUserDraft {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly db = inject(REALTIME_DATABASE);

  watchUsers(): Observable<ShopUserProfile[]> {
    const usersQuery = query(ref(this.db, 'users'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        usersQuery,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows: ShopUserProfile[] = Object.entries(val).map(([id, data]) =>
            mapUserRecord(id, data),
          );
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async saveUser(draft: ShopUserDraft, isNew: boolean): Promise<void> {
    const uid = draft.uid.trim();
    if (!uid) throw new Error('User ID (uid) is required.');
    const payload = {
      email: draft.email.trim(),
      displayName: draft.displayName.trim(),
      role: draft.role,
      active: draft.active,
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
    };
    if (isNew) {
      await set(ref(this.db, `users/${uid}`), payload);
    } else {
      await update(ref(this.db, `users/${uid}`), payload);
    }
  }

  async deleteUser(uid: string): Promise<void> {
    await remove(ref(this.db, `users/${uid}`));
  }
}

function mapUserRecord(id: string, data: Record<string, unknown>): ShopUserProfile {
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
