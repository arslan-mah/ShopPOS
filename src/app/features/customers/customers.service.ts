import { inject, Injectable } from '@angular/core';
import { onValue, orderByChild, push, query, ref, remove, serverTimestamp, set } from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export interface Customer {
  id: string;
  fullName: string;
  address: string;
  phone: string;
  cnic: string;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly db = inject(REALTIME_DATABASE);

  /** Live-updating list from Realtime Database. */
  watchCustomers(): Observable<Customer[]> {
    const customersQuery = query(ref(this.db, 'customers'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        customersQuery,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows: Customer[] = Object.entries(val).map(([id, data]) =>
            mapCustomerRecord(id, data),
          );
          rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addCustomer(fullName: string, address: string, phone: string, cnic: string): Promise<void> {
    const listRef = ref(this.db, 'customers');
    const newRef = push(listRef);
    await set(newRef, {
      fullName: fullName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      cnic: cnic.trim(),
      createdAt: serverTimestamp(),
    });
  }

  async deleteCustomer(id: string): Promise<void> {
    await remove(ref(this.db, `customers/${id}`));
  }
}

function mapCustomerRecord(id: string, data: Record<string, unknown>): Customer {
  const fullName =
    typeof data['fullName'] === 'string'
      ? data['fullName']
      : typeof data['name'] === 'string'
        ? data['name']
        : '';
  const address = typeof data['address'] === 'string' ? data['address'] : '';
  const phone = typeof data['phone'] === 'string' ? data['phone'] : '';
  const cnic = typeof data['cnic'] === 'string' ? data['cnic'] : '';
  return {
    id,
    fullName,
    address,
    phone,
    cnic,
    createdAt: parseCreatedAt(data['createdAt']),
  };
}

function parseCreatedAt(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return new Date(v);
  }
  return null;
}
