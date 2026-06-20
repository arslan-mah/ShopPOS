import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { FirebaseError } from 'firebase/app';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ThemeService } from '../../../core/theme/theme.service';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    CardModule,
    FloatLabelModule,
    InputTextModule,
    ButtonModule,
    MessageModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  readonly isSignUp = signal(false);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  toggleMode(): void {
    this.isSignUp.update((v) => !v);
    this.errorMessage.set(null);
  }

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.loading.set(true);

    try {
      if (this.isSignUp()) {
        await this.auth.signUp(email, password);
      } else {
        await this.auth.signIn(email, password);
      }
      await this.router.navigateByUrl('/home');
    } catch (err: unknown) {
      this.errorMessage.set(this.mapAuthError(err));
    } finally {
      this.loading.set(false);
    }
  }

  private mapAuthError(err: unknown): string {
    if (err instanceof FirebaseError) {
      switch (err.code) {
        case 'auth/invalid-email':
          return 'That email address is not valid.';
        case 'auth/user-disabled':
          return 'This account has been disabled.';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          return 'Invalid email or password.';
        case 'auth/email-already-in-use':
          return 'An account already exists with this email.';
        case 'auth/weak-password':
          return 'Password is too weak. Use at least 6 characters.';
        case 'auth/too-many-requests':
          return 'Too many attempts. Try again later.';
        case 'auth/operation-not-allowed':
          return (
            'Email/password sign-in is turned off in Firebase. Open Firebase Console → Authentication → ' +
            'Sign-in method, enable Email/Password, then try again.'
          );
        case 'auth/invalid-api-key':
        case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
          return (
            'API key rejected. In Google Cloud Console → APIs & Services → Credentials, edit your browser key: ' +
            'under API restrictions include "Identity Toolkit API", or under HTTP referrers add your app URL (e.g. http://localhost:4200).'
          );
        case 'auth/unauthorized-domain':
          return (
            'This domain is not allowed. Firebase Console → Authentication → Settings → Authorized domains — add localhost or your site host.'
          );
        case 'auth/configuration-not-found':
          return (
            'Auth is not set up for this Firebase project. Do this: (1) Firebase Console → Build → Authentication → open the page and click Get started if you see it. ' +
            '(2) Google Cloud Console (same project) → APIs & Services → Library → search "Identity Toolkit API" → Enable. ' +
            '(3) Back in Firebase → Authentication → Sign-in method → enable Email/Password. Then try sign-up again.'
          );
        default:
          return err.message || 'Something went wrong. Please try again.';
      }
    }
    return 'Something went wrong. Please try again.';
  }
}
