import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const permissions = inject(PermissionsService);
  const router = inject(Router);

  return combineLatest([
    toObservable(auth.ready).pipe(filter((ready) => ready), take(1)),
    toObservable(permissions.ready).pipe(filter((ready) => ready), take(1)),
  ]).pipe(
    map(() => {
      if (!auth.user()) return router.createUrlTree(['/login']);
      const profile = permissions.profile();
      if (!profile || !profile.active) return router.createUrlTree(['/login']);
      return true;
    }),
  );
};
