// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Establishes the member session the accessible-frontend a11y scan needs.
 *
 * Runs as a Playwright setup project that the scan depends on, so a login
 * failure fails the run outright instead of quietly leaving every member page
 * scanning the login page. See e2e/helpers/accessible-auth.ts for the history.
 */

import { test as setup } from '@playwright/test';
import {
  ALPHA_AUTH_FILE,
  ensureAuthDir,
  loginAsAlphaMember,
} from '../helpers/accessible-auth';

setup('authenticate as an accessible-frontend member', async ({ page }) => {
  ensureAuthDir();
  await loginAsAlphaMember(page);
  await page.context().storageState({ path: ALPHA_AUTH_FILE });
});
