import { Component } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { RouterOutlet } from '@angular/router';
import { ShopHeaderComponent } from './shop-header/shop-header.component';
import { ShopSidebarComponent } from './shop-sidebar/shop-sidebar.component';

@Component({
  selector: 'app-shop-layout',
  imports: [MatSidenavModule, ShopSidebarComponent, ShopHeaderComponent, RouterOutlet],
  templateUrl: './shop-layout.component.html',
  styleUrl: './shop-layout.component.scss',
})
export class ShopLayoutComponent {}
