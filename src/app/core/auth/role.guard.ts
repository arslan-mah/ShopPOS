import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs/operators';
import { PermissionsService } from './permissions.service';
import { UserRole } from './roles';

export const roleGuard: CanActivateFn = (route) => {
  const permissions = inject(PermissionsService);
  const router = inject(Router);
  const allowed = route.data['roles'] as UserRole[] | undefined;

  if (!allowed?.length) return true;

  return toObservable(permissions.ready).pipe(
    filter((ready) => ready),
    take(1),
    map(() => {
      if (permissions.hasRole(...allowed)) return true;
      return router.createUrlTree([permissions.defaultLandingPath()]);
    }),
  );
};
