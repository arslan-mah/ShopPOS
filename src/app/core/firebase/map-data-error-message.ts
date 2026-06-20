import { FirebaseError } from 'firebase/app';

/** Maps Firebase / RTDB / network errors to a user-visible string (RTDB often uses plain `Error`, not `FirebaseError`). */
export function mapDataErrorMessage(err: unknown): string {
  const raw = extractRawMessage(err);
  if (!raw) {
    return 'Could not complete the request.';
  }

  if (/PERMISSION_DENIED|permission denied/i.test(raw)) {
    return (
      `${raw} — If this persists: open Firebase Console → Realtime Database → Rules, ensure auth != null is allowed for ` +
      `products and customers, then Publish. Confirm databaseURL in firebase.config.ts matches your project database URL.`
    );
  }

  if (/network|fetch|Failed to fetch|offline/i.test(raw)) {
    return `${raw} — Check your internet connection and try again.`;
  }

  return raw;
}

function extractRawMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') {
      return m;
    }
  }
  return '';
}
