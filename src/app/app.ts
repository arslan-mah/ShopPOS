import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  /** Apply saved / system theme as soon as the app boots */
  private readonly _theme = inject(ThemeService);

  protected readonly title = signal('my_shop_pos');
}
