// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A member must be able to delete their account from inside the app.
 *
 * 🔴 Owner-reported, 2026-08-25: "There should be a way to delete the account in the app on
 * the settings page. There is in the React application frontend, so why is it not in the
 * mobile app?" There was not. The web app's settings page has had account deletion since
 * before this app existed; the app had no row, no screen and no API call. It is also a hard
 * Google Play requirement — an app that lets people create an account must let them delete
 * it in the app, not only on a website — so shipping without it is a rejected submission.
 *
 * These are source scans rather than renders because what regressed is *reachability*, and
 * a render test of a screen nothing links to still passes. The screen's own behaviour is
 * covered by `(modals)/settings-delete-account.test.tsx`.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP = __dirname;
const MOBILE = path.resolve(APP, '..');

const read = (relative: string) => fs.readFileSync(path.resolve(MOBILE, relative), 'utf8');

describe('account deletion is reachable from settings', () => {
  const settings = read('app/(modals)/settings.tsx');

  it('the settings screen links to the delete-account screen', () => {
    expect(settings).toMatch(/router\.push\('\/\(modals\)\/settings-delete-account' as Href\)/);
  });

  it('the row is labelled from the settings namespace, not hardcoded', () => {
    expect(settings).toMatch(/label=\{t\('deleteAccount\.title'\)\}/);
  });

  it('the screen exists', () => {
    expect(fs.existsSync(path.resolve(MOBILE, 'app/(modals)/settings-delete-account.tsx'))).toBe(true);
  });
});

describe('account deletion uses the web app’s endpoint, and sends the password safely', () => {
  const settingsApi = read('lib/api/settings.ts');

  it('calls DELETE /v2/users/me — the same endpoint the web app calls', () => {
    // Not a second erasure path, and not the admin GDPR route: the server-side behaviour
    // (password re-auth, then GdprService::executeAccountDeletion) must be the one that is
    // already in production for web members.
    expect(settingsApi).toMatch(/api\.delete<unknown>\(`\$\{API_V2\}\/users\/me`/);
  });

  it('sends the password in the body, never in the query string', () => {
    expect(settingsApi).toMatch(/\{ body: \{ password \} \}/);
    // A password in a URL is written to server logs, proxy logs and crash reports. Laravel
    // reads the query string too, so this would have "worked".
    expect(settingsApi).not.toMatch(/password=\$\{/);
    expect(settingsApi).not.toMatch(/\?password=/);
  });
});

describe('the delete-account screen is translated everywhere the app is', () => {
  // A legally required, irreversible screen showing raw keys ("deleteAccount.submit") in
  // six of seven languages would be worse than not shipping it.
  const LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es'];
  const REQUIRED = [
    'title',
    'settingsHint',
    'warning',
    'warningBody',
    'confirmTitle',
    'typeConfirm',
    'confirmationLabel',
    'keyword',
    'passwordLabel',
    'submit',
    'deleting',
    'done',
    'doneBody',
    'failed',
    'failedBody',
    'confirmRequired',
    'confirmRequiredBody',
    'alternativeHint',
  ];
  const CONSEQUENCES = ['profile', 'listings', 'messages', 'credits', 'signIn'];

  it.each(LOCALES)('%s has every string the screen renders', (locale) => {
    const catalogue = JSON.parse(read(`locales/${locale}/settings.json`)) as {
      deleteAccount?: Record<string, unknown> & { consequences?: Record<string, unknown> };
    };
    const block = catalogue.deleteAccount;
    expect(block).toBeDefined();

    const missing = REQUIRED.filter((key) => typeof block?.[key] !== 'string');
    const missingConsequences = CONSEQUENCES.filter(
      (key) => typeof block?.consequences?.[key] !== 'string',
    );
    expect({ missing, missingConsequences }).toEqual({ missing: [], missingConsequences: [] });
  });

  it.each(LOCALES)('%s keeps the confirmation keyword as DELETE', (locale) => {
    // The keyword is deliberately NOT translated, in this app and in the web app's eleven
    // locales. Translating it in one place and not the other is how the web app once
    // locked members out of deleting their own accounts.
    const catalogue = JSON.parse(read(`locales/${locale}/settings.json`)) as {
      deleteAccount?: { keyword?: string };
    };
    expect(catalogue.deleteAccount?.keyword).toBe('DELETE');
  });

  it.each(LOCALES)('%s keeps the {{keyword}} placeholder in every sentence that names it', (locale) => {
    const catalogue = JSON.parse(read(`locales/${locale}/settings.json`)) as {
      deleteAccount?: Record<string, string>;
    };
    for (const key of ['typeConfirm', 'confirmationLabel', 'confirmRequiredBody']) {
      expect(catalogue.deleteAccount?.[key]).toContain('{{keyword}}');
    }
  });
});
