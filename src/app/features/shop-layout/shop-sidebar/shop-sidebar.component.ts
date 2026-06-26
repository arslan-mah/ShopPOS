import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PermissionsService } from '../../../core/auth/permissions.service';

@Component({
  selector: 'app-shop-sidebar',
  imports: [RouterLink, RouterLinkActive, MatListModule, MatIconModule],
  templateUrl: './shop-sidebar.component.html',
  styleUrl: './shop-sidebar.component.scss',
})
export class ShopSidebarComponent {
  protected readonly permissions = inject(PermissionsService);

  canShow(routeSegment: string): boolean {
    return this.permissions.canAccessRoute(routeSegment);
  }
}
