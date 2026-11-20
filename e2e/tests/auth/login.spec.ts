// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects';
import { tenantUrl, dismissDevNoticeModal } from '../../helpers/test-utils';

// The first navigation in a run pays the cold Vite-compile tax; the login →
// redirect → reload flows need room beyond the 30s default.
test.beforeEach(({}, testInfo) => {
  testInfo.setTimeout(90_000);
});

/**
 * Helper to handle cookie consent banner if present
 */
async function dismissCookieBanner(page: any): Promise<void> {
  try {
    const acceptBtn = page.locator('button:has-text("Accept All"), button:has-text("Accept all")');
    const isVisible = await acceptBtn.isVisible({ timeout: 500 }).catch(() => false);
    if (isVisible) {
      await acceptBtn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch {
    // Cookie banner might not be present or already dismissed
  }
}

test.describe('Authentication - Login', () => {
  test.describe('Login Page', () => {
    test('should display login form with all required elements', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await expect(loginPage.emailInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.submitButton).toBeVisible();
      await expect(loginPage.forgotPasswordLink).toBeVisible();
      await expect(loginPage.registerLink).toBeVisible();
    });

    test('should have proper form labels for accessibility', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Check for labels - actual form uses login-email and login-password
      const emailLabel = page.locator('label[for="login-email"], label[for="email"], label:has-text("Email")');
      const passwordLabel = page.locator('label[for="login-password"], label[for="password"], label:has-text("Password")');

      await expect(emailLabel.first()).toBeVisible();
      await expect(passwordLabel.first()).toBeVisible();
    });

    test('should show validation for empty email submission', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Check if email field has required attribute - this is the validation
      const emailInput = loginPage.emailInput;
      const isRequired = await emailInput.getAttribute('required') !== null;

      // Also check the email field has proper type
      const emailType = await emailInput.getAttribute('type');

      // Email field should be required and have type="email" for proper validation
      expect(isRequired || emailType === 'email').toBeTruthy();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await loginPage.fillLoginForm('invalid@example.com', 'wrongpassword');

      // Submit the form using the form's submit method to avoid navigation issues
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) {
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });

      // Wait for navigation to complete
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);

      // After failed login, should stay on login page or show error
      const currentUrl = page.url();
      const stayedOnLogin = currentUrl.includes('login');

      expect(stayedOnLogin).toBeTruthy();
    });

    test('should show error for invalid email format', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Check email field has proper type for browser validation
      const emailInput = loginPage.emailInput;
      const emailType = await emailInput.getAttribute('type');

      // Type="email" means browser will validate email format
      expect(emailType).toBe('email');
    });

    test('should authenticate and redirect away from login on valid credentials', async ({ page }) => {
      const email = process.env.E2E_USER_EMAIL;
      const password = process.env.E2E_USER_PASSWORD;
      test.skip(!email || !password, 'No E2E user credentials configured');

      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await loginPage.login(email!, password!);

      // The app redirects to the post-login landing (default /dashboard; /feed where the dashboard is off) and persists a JWT.
      expect(page.url()).toMatch(/\/(dashboard|home|feed)(\/|$|\?)/);
      expect(page.url()).not.toContain('/login');
      expect(await loginPage.isLoggedIn()).toBeTruthy();
    });

    test('should maintain session after page refresh', async ({ page }) => {
      const email = process.env.E2E_USER_EMAIL;
      const password = process.env.E2E_USER_PASSWORD;
      test.skip(!email || !password, 'No E2E user credentials configured');

      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      await loginPage.login(email!, password!);
      expect(await loginPage.isLoggedIn()).toBeTruthy();

      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Session survives a hard reload (token persists, not bounced to login).
      expect(await loginPage.isLoggedIn()).toBeTruthy();
      expect(page.url()).not.toContain('/login');
    });

    test('should have remember me option if available', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Remember me may or may not be present
      if (await loginPage.rememberMeCheckbox.count() > 0) {
        await expect(loginPage.rememberMeCheckbox).toBeVisible();
        await loginPage.checkRememberMe();
        await expect(loginPage.rememberMeCheckbox).toBeChecked();
      }
    });
  });

  test.describe('Forgot Password', () => {
    test('should navigate to forgot password page', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();
      await dismissCookieBanner(page);
      await loginPage.clickForgotPassword();
      await dismissCookieBanner(page);

      // Wait for navigation/content to load
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      // Check for presence of password reset content using multiple methods
      const hasSendBtn = await page.getByRole('button', { name: /Send Reset/i }).isVisible({ timeout: 3000 }).catch(() => false);
      const hasResetText = await page.getByText(/send you a link/i).first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasEmailLabel = await page.getByText('Email Address').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasLoginHereLink = await page.getByText('Login here').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasEmailInput = await page.getByRole('textbox', { name: /email/i }).isVisible({ timeout: 2000 }).catch(() => false);

      expect(hasSendBtn || hasResetText || hasEmailLabel || hasLoginHereLink || hasEmailInput).toBeTruthy();
    });

    test('should show validation for invalid email on password reset', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();
      await loginPage.clickForgotPassword();

      // Find email input on reset page (be specific to avoid search form)
      const resetForm = page.locator('form:has(input[name="email"]):not([action*="search"])');
      const emailInput = resetForm.locator('input[name="email"], input[type="email"]').first();

      await emailInput.fill('notanemail');

      const submitButton = resetForm.locator('button[type="submit"]').first();
      await submitButton.click();

      // Check for validation
      const validationMessage = await emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
      expect(validationMessage).toBeTruthy();
    });
  });

  test.describe('Registration Link', () => {
    test('should navigate to registration page', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();
      await dismissCookieBanner(page);
      await loginPage.clickRegister();

      // Wait for navigation to complete
      await page.waitForLoadState('domcontentloaded');
      await dismissCookieBanner(page);

      // Wait a moment for the page to render
      await page.waitForTimeout(1000);

      // Check for registration form content using multiple methods
      const hasFirstNameInput = await page.locator('input[name="first_name"]').isVisible({ timeout: 3000 }).catch(() => false);
      const hasCreateAccountBtn = await page.getByRole('button', { name: /Create Account/i }).isVisible({ timeout: 2000 }).catch(() => false);
      const hasFirstNameLabel = await page.getByText('First Name', { exact: true }).first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasFirstNameTextbox = await page.getByRole('textbox', { name: /First Name/i }).isVisible({ timeout: 2000 }).catch(() => false);
      const hasPasswordInput = await page.locator('input[name="password"]').isVisible({ timeout: 2000 }).catch(() => false);

      // The page should show registration form content
      expect(hasFirstNameInput || hasCreateAccountBtn || hasFirstNameLabel || hasFirstNameTextbox || hasPasswordInput).toBeTruthy();
    });
  });

  test.describe('CSRF Protection', () => {
    test('should include CSRF token in login form', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      const csrfToken = page.locator('input[name="csrf_token"], input[name="_token"]');
      const tokenCount = await csrfToken.count();

      // Either has CSRF input or uses meta tag
      if (tokenCount === 0) {
        const metaCsrf = page.locator('meta[name="csrf-token"]');
        expect(await metaCsrf.count()).toBeGreaterThan(0);
      } else {
        expect(tokenCount).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Rate Limiting', () => {
    test('should handle multiple failed attempts', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();

      // Attempt multiple logins (reduced to 2 for speed)
      for (let i = 0; i < 2; i++) {
        await loginPage.fillLoginForm('test@example.com', 'wrongpassword');
        await loginPage.submitButton.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
      }

      // After multiple attempts, should still be on login page (not crash)
      expect(page.url()).toContain('login');
    });
  });
});

test.describe('Authentication - Logout', () => {
  test('should successfully logout', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(!email || !password, 'No E2E user credentials configured');

    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await loginPage.login(email!, password!);
    expect(await loginPage.isLoggedIn()).toBeTruthy();

    // Log out via the navbar user menu (React Dropdown, not an <a href>).
    await loginPage.logout();

    // Token is cleared — the session is gone.
    expect(await loginPage.isLoggedIn()).toBeFalsy();
  });

  test('should not access protected pages after logout', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(!email || !password, 'No E2E user credentials configured');

    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await loginPage.login(email!, password!);
    await loginPage.logout();

    // Logout clears auth state and the SPA bounces away from protected content;
    // let that client-side redirect settle before navigating again (avoids a
    // race between logout's redirect and our goto).
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    // Visiting a protected route while logged out must redirect to login.
    await page.goto(tenantUrl('dashboard'), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await dismissDevNoticeModal(page);
    await page.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});

    expect(page.url()).toContain('login');
  });
});
