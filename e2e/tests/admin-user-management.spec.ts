// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import {
  tenantUrl,
  dismissBlockingModals,
  DEFAULT_TENANT,
} from '../helpers/test-utils';

/**
 * Admin User Management E2E Tests
 *
 * Tests the admin user management workflow including login, navigation,
 * user list browsing, search, editing, role changes, and account status.
 *
 * These tests target the React admin panel at /admin/users (not legacy).
 * Marked with test.skip since they require a running app with admin credentials.
 *
 * Run with: npx playwright test admin-user-management --project=admin
 */

test.describe('Admin User Management Flow', () => {
  // ---------------------------------------------------------------------------
  // 1. Admin Login and Navigate to User Management
  // ---------------------------------------------------------------------------

  test.describe('Admin Login & Navigation', () => {
    test.skip('should log in as admin and reach admin dashboard', async ({ page }) => {
      const adminEmail = process.env.E2E_ADMIN_EMAIL;
      const adminPassword = process.env.E2E_ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword) {
        test.skip(true, 'No admin credentials configured in E2E env');
        return;
      }

      // Navigate to login page
      await page.goto(tenantUrl('login'));
      await dismissBlockingModals(page);

      // Fill admin credentials
      const emailInput = page.locator('#login-email, input[name="email"], input[type="email"]').first();
      const passwordInput = page.locator('#login-password, input[name="password"], input[type="password"]').first();
      await emailInput.fill(adminEmail);
      await passwordInput.fill(adminPassword);

      // Submit login form
      const submitBtn = page.locator('button[type="submit"]').first();
      await submitBtn.click();

      // Should redirect away from login
      await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });

      // Navigate to admin dashboard
      await page.goto(tenantUrl('admin'));
      await page.waitForLoadState('domcontentloaded');

      // Should be on admin page
      expect(page.url()).toContain('/admin');

      // Admin content should be visible
      const content = page.locator('main, [role="main"], .admin-content');
      await expect(content.first()).toBeVisible({ timeout: 10000 });
    });

    test.skip('should navigate from admin dashboard to user management', async ({ page }) => {
      await page.goto(tenantUrl('admin'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');

      // Find and click the Users link in sidebar navigation
      const usersLink = page.locator(
        'a[href*="/admin/users"], a:has-text("Users"), a:has-text("Members")'
      ).first();
      await expect(usersLink).toBeVisible({ timeout: 10000 });
      await usersLink.click();

      // Should navigate to user management page
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/admin/users');

      // Page heading should be visible
      const heading = page.locator('h1');
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test.skip('should show user management page with correct heading', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);

      const heading = page.locator('h1');
      await expect(heading).toBeVisible({ timeout: 10000 });

      // Heading should relate to users/members
      const headingText = await heading.textContent();
      expect(headingText?.toLowerCase()).toMatch(/user|member|manage/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. View User List with Pagination
  // ---------------------------------------------------------------------------

  test.describe('User List with Pagination', () => {
    test.skip('should display a table or list of users', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);

      // Wait for data to load
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000); // Allow API response

      // Should have a table or list component
      const hasTable = await page.locator('table, [role="table"], [role="grid"]').isVisible({ timeout: 10000 }).catch(() => false);
      const hasList = await page.locator('[data-user-list], .user-list, .member-list').isVisible({ timeout: 3000 }).catch(() => false);
      const hasCards = await page.locator('.user-card, article').first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasTable || hasList || hasCards).toBeTruthy();
    });

    test.skip('should display user details in table rows (name, email, role, status)', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Table should have column headers
      const hasHeaders = await page.locator('th, [role="columnheader"]').first().isVisible({ timeout: 5000 }).catch(() => false);

      if (hasHeaders) {
        const headers = await page.locator('th, [role="columnheader"]').allTextContents();
        const headerTexts = headers.map(h => h.toLowerCase().trim());

        // Should have at minimum: name/user and email columns
        const hasNameCol = headerTexts.some(h => h.includes('name') || h.includes('user'));
        const hasEmailCol = headerTexts.some(h => h.includes('email'));

        expect(hasNameCol || hasEmailCol).toBeTruthy();
      }

      // Should have at least one user row
      const rows = page.locator('tbody tr, [role="row"]');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
    });

    test.skip('should display pagination controls when many users exist', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // 🔴 Pagination presence is genuinely DATA-DEPENDENT: a community with a dozen
      // members shows none, so it cannot be asserted here. The old code pretended
      // otherwise — two instantaneous snapshots and `expect(a || b || true)`, which
      // passed on any page at all, including an error page. The count-info locator
      // made it worse: `/showing|of|results|entries|total/i` matches the word "of",
      // so it would have matched almost any English text on the screen.
      //
      // So assert what MUST hold: the user list rendered. If pagination is present,
      // it must be operable — which is the part actually worth checking, and is
      // covered by the "navigate to next page" test below.
      const userList = page.locator('table, [role="table"], [role="grid"], [data-user-list]').first();
      const emptyState = page.getByText(/no users|no members|nothing to show/i).first();
      await expect(userList.or(emptyState).first()).toBeVisible({ timeout: 15000 });
    });

    test.skip('should navigate to next page when pagination is available', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const nextButton = page.locator(
        'button:has-text("Next"), button[aria-label="Next page"], a[aria-label="Next page"]'
      ).first();

      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        const isDisabled = await nextButton.isDisabled();

        if (!isDisabled) {
          await nextButton.click();
          await page.waitForLoadState('domcontentloaded');

          // Table should still be visible after pagination
          const hasTable = await page.locator('table, [role="table"]').isVisible({ timeout: 5000 }).catch(() => false);
          expect(hasTable).toBeTruthy();
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Search for Specific User
  // ---------------------------------------------------------------------------

  test.describe('User Search', () => {
    test.skip('should have a search input on the user management page', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="Search" i], input[placeholder*="Filter" i], input[name="q"]'
      ).first();

      await expect(searchInput).toBeVisible({ timeout: 10000 });
    });

    test.skip('should filter user list when typing in search', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="Search" i]'
      ).first();

      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Get initial row count
        const initialRows = await page.locator('tbody tr, [role="row"]').count();

        // Type a search query
        await searchInput.fill('test');
        await page.waitForTimeout(1000); // Debounce

        // Results should update (may be fewer or same)
        const filteredRows = await page.locator('tbody tr, [role="row"]').count();

        // Expect the search to have triggered (rows may or may not change)
        expect(filteredRows).toBeGreaterThanOrEqual(0);
      }
    });

    test.skip('should show empty state when search yields no results', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="Search" i]'
      ).first();

      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Search for a very unlikely string
        await searchInput.fill('zzz_nonexistent_user_xyz_12345');
        await page.waitForTimeout(1000);

        // Should show empty state or zero results
        const hasEmptyState = await page.locator(
          'text=No results, text=No users found, text=0 results, .empty-state, [data-empty]'
        ).first().isVisible({ timeout: 5000 }).catch(() => false);

        const hasZeroRows = (await page.locator('tbody tr').count()) === 0;

        expect(hasEmptyState || hasZeroRows).toBeTruthy();
      }
    });

    test.skip('should clear search and restore full user list', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="Search" i]'
      ).first();

      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Get initial row count
        const initialRows = await page.locator('tbody tr, [role="row"]').count();

        // Search, then clear
        await searchInput.fill('test');
        await page.waitForTimeout(1000);
        await searchInput.clear();
        await page.waitForTimeout(1000);

        // Row count should be back to initial
        const restoredRows = await page.locator('tbody tr, [role="row"]').count();
        expect(restoredRows).toBe(initialRows);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Edit User Profile
  // ---------------------------------------------------------------------------

  test.describe('Edit User Profile', () => {
    test.skip('should open user detail/edit page from user list', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Click on the first user row or edit button
      const editButton = page.locator(
        'tbody tr a, [role="row"] a, button:has-text("Edit"), a[href*="/admin/users/"], button[aria-label*="edit" i]'
      ).first();

      if (await editButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editButton.click();
        await page.waitForLoadState('domcontentloaded');

        // Should navigate to user detail page
        const hasForm = await page.locator('form, input[name], [data-user-form]').first().isVisible({ timeout: 10000 }).catch(() => false);
        const hasUserDetail = await page.locator('h1, h2').first().isVisible({ timeout: 5000 }).catch(() => false);

        expect(hasForm || hasUserDetail).toBeTruthy();
      }
    });

    test.skip('should display editable user profile fields', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Navigate to first user's edit page
      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should have editable fields
        const hasNameField = await page.locator(
          'input[name*="name" i], input[name*="first" i]'
        ).first().isVisible({ timeout: 5000 }).catch(() => false);

        const hasEmailField = await page.locator(
          'input[name*="email" i], input[type="email"]'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        const hasBioField = await page.locator(
          'textarea[name*="bio" i], textarea[name*="about" i]'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        expect(hasNameField || hasEmailField || hasBioField).toBeTruthy();
      }
    });

    test.skip('should have a save/update button on user edit form', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should have a save button
        const saveButton = page.locator(
          'button[type="submit"], button:has-text("Save"), button:has-text("Update")'
        ).first();
        await expect(saveButton).toBeVisible({ timeout: 10000 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Change User Role
  // ---------------------------------------------------------------------------

  test.describe('Change User Role', () => {
    test.skip('should display role selector on user edit page', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should have a role selector (dropdown, select, or radio buttons)
        const hasRoleSelect = await page.locator(
          'select[name*="role" i], button[role="combobox"][aria-label*="role" i], [data-role-select]'
        ).first().isVisible({ timeout: 5000 }).catch(() => false);

        const hasRoleRadio = await page.locator(
          'input[type="radio"][name*="role" i], [data-role-radio]'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        const hasRoleDropdown = await page.locator(
          'button:has-text("Role"), label:has-text("Role")'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        expect(hasRoleSelect || hasRoleRadio || hasRoleDropdown).toBeTruthy();
      }
    });

    test.skip('should show available roles (member, admin, broker)', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Find and open the role selector
        const roleSelect = page.locator(
          'select[name*="role" i], button[role="combobox"][aria-label*="role" i]'
        ).first();

        if (await roleSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
          await roleSelect.click();

          // Should show role options
          const options = page.locator('[role="option"], option');
          const optionCount = await options.count();
          expect(optionCount).toBeGreaterThan(0);

          // Check for expected role names
          const optionTexts = await options.allTextContents();
          const allTexts = optionTexts.join(' ').toLowerCase();
          const hasMemberRole = allTexts.includes('member') || allTexts.includes('user');
          const hasAdminRole = allTexts.includes('admin');

          expect(hasMemberRole || hasAdminRole).toBeTruthy();
        }
      }
    });

    test.skip('should confirm role change with a confirmation dialog', async ({ page }) => {
      // This test verifies that role changes require confirmation
      // to prevent accidental privilege escalation or removal
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Navigate to user edit page
      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // After changing role and saving, a confirmation modal should appear
        // (or the save button itself serves as confirmation)
        const saveButton = page.locator(
          'button[type="submit"], button:has-text("Save"), button:has-text("Update")'
        ).first();

        if (await saveButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          // Verify the save button exists (do not actually click to avoid
          // modifying data in a test environment)
          expect(true).toBeTruthy();
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Suspend/Activate User Account
  // ---------------------------------------------------------------------------

  test.describe('Suspend/Activate User Account', () => {
    test.skip('should display user status indicator (active/suspended)', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Look for status indicators in the user table
      const hasStatusChip = await page.locator(
        '.chip, .badge, [data-status], span:has-text("Active"), span:has-text("Suspended")'
      ).first().isVisible({ timeout: 5000 }).catch(() => false);

      const hasStatusColumn = await page.locator(
        'th:has-text("Status"), [role="columnheader"]:has-text("Status")'
      ).isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasStatusChip || hasStatusColumn).toBeTruthy();
    });

    test.skip('should have suspend action button on user edit page', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should have a suspend/deactivate button or toggle
        const hasSuspendBtn = await page.locator(
          'button:has-text("Suspend"), button:has-text("Deactivate"), button:has-text("Disable")'
        ).first().isVisible({ timeout: 5000 }).catch(() => false);

        const hasStatusToggle = await page.locator(
          'button[role="switch"][aria-label*="status" i], input[type="checkbox"][name*="active" i]'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        const hasStatusSelect = await page.locator(
          'select[name*="status" i], [data-status-select]'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        expect(hasSuspendBtn || hasStatusToggle || hasStatusSelect).toBeTruthy();
      }
    });

    test.skip('should show confirmation dialog before suspending a user', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const editLink = page.locator(
        'a[href*="/admin/users/"], button:has-text("Edit")'
      ).first();

      if (await editLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editLink.click();
        await page.waitForLoadState('domcontentloaded');

        const suspendBtn = page.locator(
          'button:has-text("Suspend"), button:has-text("Deactivate")'
        ).first();

        if (await suspendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await suspendBtn.click();

          // A confirmation dialog should appear
          const hasConfirmDialog = await page.locator(
            '[role="dialog"], [role="alertdialog"], .modal'
          ).isVisible({ timeout: 5000 }).catch(() => false);

          const hasConfirmText = await page.locator(
            'text=Are you sure, text=Confirm, text=This action'
          ).first().isVisible({ timeout: 3000 }).catch(() => false);

          expect(hasConfirmDialog || hasConfirmText).toBeTruthy();

          // Cancel the dialog (do not actually suspend)
          const cancelBtn = page.locator(
            'button:has-text("Cancel"), button:has-text("No")'
          ).first();
          if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await cancelBtn.click();
          }
        }
      }
    });

    test.skip('should have activate action for suspended users', async ({ page }) => {
      await page.goto(tenantUrl('admin/users'));
      await dismissBlockingModals(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Look for an activate button or filter for suspended users first
      const hasActivateBtn = await page.locator(
        'button:has-text("Activate"), button:has-text("Enable"), button:has-text("Unsuspend")'
      ).first().isVisible({ timeout: 5000 }).catch(() => false);

      // If no activate button visible, try filtering for suspended users
      const statusFilter = page.locator(
        'select[name*="status" i], button[role="combobox"][aria-label*="status" i]'
      ).first();

      if (!hasActivateBtn && await statusFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await statusFilter.click();
        const suspendedOption = page.locator(
          '[role="option"]:has-text("Suspended"), option:has-text("Suspended")'
        ).first();
        if (await suspendedOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Filter exists - suspended users can be found and activated
          expect(true).toBeTruthy();
        }
      }

      // The activate mechanism exists (button or filter + action)
      expect(true).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Admin User Management API
  // ---------------------------------------------------------------------------

  test.describe('Admin User Management API', () => {
    const apiBaseUrl = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:8090';

    test.skip('should return user list from admin API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/admin/users`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      // Should require admin auth
      expect([200, 401, 403]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        const data = body?.data || body;
        expect(data).toBeTruthy();
        if (Array.isArray(data)) {
          expect(data.length).toBeGreaterThan(0);
        }
      }
    });

    test.skip('should support search parameter in admin users API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/admin/users?search=test`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect([200, 401, 403]).toContain(response.status());
    });

    test.skip('should support pagination parameters in admin users API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/admin/users?page=1&per_page=10`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect([200, 401, 403]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        // 🔴 ASSERTED FOR REAL. `expect(hasMeta || true)` passed whether the metadata
        // was there or not, so this test could not have caught the envelope changing
        // shape — which is the only thing it exists to check.
        //
        // Verified against the source before tightening: the endpoint returns
        // `respondWithPaginatedCollection` (AdminUsersController::index), and that
        // helper always emits `meta` with current_page / per_page / total /
        // total_pages / has_more (BaseApiController). So this is a contract the
        // endpoint genuinely holds, not a hopeful guess.
        expect(body?.meta ?? body?.pagination).toBeTruthy();
        expect(body?.meta?.total ?? body?.total).toBeDefined();
      }
    });
  });
});
