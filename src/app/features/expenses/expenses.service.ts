import { inject, Injectable } from '@angular/core';
import {
  endAt,
  get,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  startAt,
  update,
} from 'firebase/database';
import { Observable } from 'rxjs';
import { REALTIME_DATABASE } from '../../core/firebase/firebase.tokens';

export interface ExpenseCategory {
  id: string;
  name: string;
  createdAt: Date | null;
}

export interface Expense {
  id: string;
  categoryId?: string;
  title: string;
  description?: string;
  amount: number;
  paymentMethod: string;
  date: Date | null;
  createdAt: Date | null;
}

export interface ExpenseDraft {
  categoryId?: string;
  title: string;
  description?: string;
  amount: number;
  paymentMethod: string;
  date: Date;
}

const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Salaries', 'Internet', 'Fuel', 'Miscellaneous'];

@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly db = inject(REALTIME_DATABASE);

  watchExpenses(): Observable<Expense[]> {
    const q = query(ref(this.db, 'expenses'), orderByChild('createdAt'));
    return this.watchExpensesQuery(q);
  }

  watchExpensesInRange(startMs: number, endMs: number): Observable<Expense[]> {
    const q = query(
      ref(this.db, 'expenses'),
      orderByChild('date'),
      startAt(startMs),
      endAt(endMs),
    );
    return this.watchExpensesQuery(q);
  }

  private watchExpensesQuery(q: ReturnType<typeof query>): Observable<Expense[]> {
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapExpense(id, data));
          rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  watchExpenseCategories(): Observable<ExpenseCategory[]> {
    const q = query(ref(this.db, 'expenseCategories'), orderByChild('createdAt'));
    return new Observable((subscriber) => {
      const unsub = onValue(
        q,
        (snapshot) => {
          const val = snapshot.val() as Record<string, Record<string, unknown>> | null;
          if (!val) {
            subscriber.next([]);
            return;
          }
          const rows = Object.entries(val).map(([id, data]) => mapCategory(id, data));
          rows.sort((a, b) => a.name.localeCompare(b.name));
          subscriber.next(rows);
        },
        (err) => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async ensureDefaultCategories(): Promise<void> {
    const snap = await new Promise<{ empty: boolean }>((resolve, reject) => {
      const q = query(ref(this.db, 'expenseCategories'), orderByChild('createdAt'));
      onValue(
        q,
        (s) => {
          const val = s.val();
          resolve({ empty: !val || Object.keys(val).length === 0 });
        },
        reject,
        { onlyOnce: true },
      );
    });
    if (!snap.empty) return;
    for (const name of DEFAULT_CATEGORIES) {
      const newRef = push(ref(this.db, 'expenseCategories'));
      await set(newRef, { name, createdAt: serverTimestamp() });
    }
  }

  async addExpense(draft: ExpenseDraft): Promise<void> {
    const newRef = push(ref(this.db, 'expenses'));
    await set(newRef, {
      categoryId: draft.categoryId ?? '',
      title: draft.title.trim(),
      description: draft.description?.trim() ?? '',
      amount: draft.amount,
      paymentMethod: draft.paymentMethod.trim(),
      date: draft.date.getTime(),
      createdAt: serverTimestamp(),
    });
  }

  async updateExpense(id: string, draft: ExpenseDraft): Promise<void> {
    await update(ref(this.db, `expenses/${id}`), {
      categoryId: draft.categoryId ?? '',
      title: draft.title.trim(),
      description: draft.description?.trim() ?? '',
      amount: draft.amount,
      paymentMethod: draft.paymentMethod.trim(),
      date: draft.date.getTime(),
    });
  }

  async deleteExpense(id: string): Promise<void> {
    await remove(ref(this.db, `expenses/${id}`));
  }
}

function mapExpense(id: string, data: Record<string, unknown>): Expense {
  return {
    id,
    categoryId: str(data['categoryId'], '') || undefined,
    title: str(data['title'], ''),
    description: str(data['description'], '') || undefined,
    amount: num(data['amount'], 0),
    paymentMethod: str(data['paymentMethod'], ''),
    date: parseTs(data['date']),
    createdAt: parseTs(data['createdAt']),
  };
}

function mapCategory(id: string, data: Record<string, unknown>): ExpenseCategory {
  return {
    id,
    name: str(data['name'], ''),
    createdAt: parseTs(data['createdAt']),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function parseTs(v: unknown): Date | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return new Date(v);
  return null;
}
