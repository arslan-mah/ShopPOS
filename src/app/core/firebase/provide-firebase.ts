import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { firebaseConfig } from './firebase.config';
import { FIREBASE_APP, FIREBASE_AUTH, REALTIME_DATABASE } from './firebase.tokens';

export function provideFirebase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_APP,
      useFactory: () => initializeApp(firebaseConfig),
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: (app: ReturnType<typeof initializeApp>) => getAuth(app),
      deps: [FIREBASE_APP],
    },
    {
      provide: REALTIME_DATABASE,
      useFactory: (app: ReturnType<typeof initializeApp>) => getDatabase(app),
      deps: [FIREBASE_APP],
    },
    provideAppInitializer(() => {
      const app = inject(FIREBASE_APP);
      void import('firebase/analytics').then(async ({ getAnalytics, isSupported }) => {
        if (await isSupported()) {
          getAnalytics(app);
        }
      });
    }),
  ]);
}
