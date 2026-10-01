// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every link that leaves the app goes through one helper, or is recorded here with a reason.
 *
 * 🔴 What this replaces. `Linking.openURL` was called from twenty-two files and each one
 * decided for itself what to check. Six were bare `void Linking.openURL(x)` with no catch —
 * and `openURL` REJECTS when the device has nothing that can handle the URL, so those were
 * unhandled promise rejections and, from the member's side, a button that did nothing at
 * all. One opened `item.tracking_url ?? ''`. Two opened a member-typed `website` field with
 * no scheme check, so the app would hand `javascript:` or any custom scheme to whatever app
 * claimed it. Audit 2026-09-09, item 9.
 *
 * 🔴 Not to be confused with `lib/utils/safeExternalLink.ts`, which is alive and used by
 * `navigateToLink` and the push handler to decide whether an INBOUND link should leave the
 * app. It refuses our own web host on purpose, so it cannot serve this job.
 *
 * 🔴 This is about HOW links open, not WHETHER. Several destinations belong outside the app
 * on purpose — Stripe, a member's own website, a meeting link, the Play Store, the AGPL
 * source repository — and `mobile/docs/MOBILE_HANDOFF.md` lists them. Nothing here should be
 * read as pressure to bring one of them in-app.
 *
 * The allowlist is for call sites whose own handling is BETTER than the shared helper's —
 * a specific recovery message, or an inline failure state — not for ones nobody has got to.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');

/**
 * 🔴 F-480. This was `['app', 'components']` — a hand-picked pair that left
 * `lib/payments/*` and `lib/utils/navigateToLink.ts` outside the gate's view. Picking
 * directories by hand is exactly how the original problem was missed, so the search now
 * starts at the whole app and names only what it skips: build output, native projects and
 * dependencies, none of which anybody edits to open a link.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'android',
  'ios',
  'dist',
  'build',
  'coverage',
  'assets',
]);

/** Relative path → why this call site keeps its own `Linking.openURL`. */
const OWN_HANDLING: Record<string, string> = {
  'app/+not-found.tsx':
    'The last-resort escape for a path this build has no screen for. Catches, and silence is the only option left.',
  'components/FeedItem.tsx':
    'Link preview card. Checks the scheme, and stays silent by design — the card is still readable and there is nothing to recover.',
  'components/courses/LessonContent.tsx':
    'Shows an inline failure state on the lesson itself, which the member can see without a transient toast.',
  'lib/utils/openExternalUrl.ts':
    'IS the shared helper. It is the one place allowed to call Linking.openURL directly.',
  'lib/utils/navigateToLink.ts':
    'Decides whether an INBOUND link leaves the app at all, through isSafeExternalBrowserLink — a stricter check than the helper\'s, and one the helper cannot make because it refuses our own web host.',
};

/**
 * 🔴 F-480, and read this before adding to it.
 *
 * These three open a URL the APP built — `buildWebUrl(tenantSlug, '<literal path>')`,
 * which is `APP_URL` + `encodeURIComponent(slug)` + a constant path, so no scheme and no
 * host can be injected into it. They are `await`ed inside an `async` function, so a device
 * with no browser rejects to the caller rather than silently doing nothing, which is why
 * they are not in `OWN_HANDLING` above: there is no `catch` here on purpose.
 *
 * An entry belongs here ONLY if the opened value is built by the app from constants. A
 * server field, a member-typed field or anything carrying a scheme goes through the helper.
 */
const APP_BUILT_WEB_URL: Record<string, string> = {
  'lib/payments/identityPayment.ts': "buildWebUrl(options.tenantSlug, '/settings/verify-identity')",
  'lib/payments/identityPayment.web.ts': "buildWebUrl(options.tenantSlug, '/settings/verify-identity')",
  'lib/payments/marketplacePayment.ts': "buildWebUrl(options.tenantSlug, '/marketplace/orders')",
};

/**
 * 🔴 F-445. Five screens were on the allowlist above because each had a BETTER
 * failure message than a generic toast — which was true, and beside the point.
 * Exempting them from the helper's failure handling also exempted them from its
 * SCHEME CHECK, so the app would have handed a `javascript:`, `data:`, `file:`
 * or `content:` URL from one of these server fields straight to whatever app on
 * the phone claims that scheme.
 *
 * No member-controlled path to any of those values was found when this was
 * recorded — the checkout URLs are Stripe's own session URLs and `updateUrl` is
 * platform config — so this is defence in depth being put back, not a hole
 * being plugged. They now call the helper AND keep their own recovery, which is
 * the shape `components/events/EventAgendaEnterprisePanel.tsx` already uses
 * (F-301, the same finding at one earlier site).
 */
const FORMERLY_EXEMPT: Record<string, string> = {
  'app/(modals)/marketplace-detail.tsx': 'payment.data.checkout_url',
  'app/(modals)/marketplace-orders.tsx': 'payment.data.checkout_url',
  'app/(modals)/marketplace-stripe-onboarding.tsx': 'the onboarding response url',
  'app/(modals)/verify-identity.tsx': 'data.redirect_url',
  'components/UpdateRequiredScreen.tsx': 'requirement.updateUrl',
};

interface SourceFile {
  relative: string;
  source: string;
}

function sourceFiles(dir: string): SourceFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return [];
      return sourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{
      relative: path.relative(MOBILE_ROOT, full).split(path.sep).join('/'),
      source: fs.readFileSync(full, 'utf8'),
    }];
  });
}

/** `//` comments only — several files discuss `Linking.openURL` in prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const files = sourceFiles(MOBILE_ROOT);

describe('external links', () => {
  it('finds the files it is meant to police', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  /*
    🔴 F-480. This gate used to search `app/` and `components/` only — the same two
    directories the audit that FOUND the original problem searched, and which its own
    docblock (above) records as having been wrong. Four real `Linking.openURL` call sites
    sat outside its view the whole time. They are all safe as written, so nothing was
    exposed; what was missing was the guarantee that the next one would be seen.

    Naming the files keeps the assertion honest: a future narrowing of the search cannot
    quietly pass by finding "enough" files.
  */
  it('searches the directories the last two audits of this gate missed', () => {
    const seen = new Set(files.map((file) => file.relative));
    expect([
      'lib/payments/identityPayment.ts',
      'lib/payments/identityPayment.web.ts',
      'lib/payments/marketplacePayment.ts',
      'lib/utils/navigateToLink.ts',
      'lib/utils/openExternalUrl.ts',
    ].filter((relative) => !seen.has(relative))).toEqual([]);
  });

  it('opens every external link through the shared helper, or says why not', () => {
    const raw = files
      .filter(({ source }) => /Linking\.openURL\s*\(/.test(stripComments(source)))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in OWN_HANDLING) && !(relative in APP_BUILT_WEB_URL));

    expect(raw).toEqual([]);
  });

  it('carries no allowlist entry for a file that no longer opens a link', () => {
    const byPath = new Map(files.map((file) => [file.relative, file]));
    const stale = [...Object.keys(OWN_HANDLING), ...Object.keys(APP_BUILT_WEB_URL)].filter((relative) => {
      const file = byPath.get(relative);
      return !file || !/Linking\.openURL\s*\(/.test(stripComments(file.source));
    });

    expect(stale).toEqual([]);
  });

  it('every allowlisted call site still handles its own failure', () => {
    // The reason each of these is exempt is that it does something BETTER than a generic
    // toast. A `.catch` or a `try` is the minimum evidence that it does anything at all.
    const unhandled = Object.keys(OWN_HANDLING).filter((relative) => {
      const source = files.find((file) => file.relative === relative)?.source ?? '';
      return !/\.catch\s*\(|try\s*\{/.test(source);
    });

    expect(unhandled).toEqual([]);
  });

  it.each(Object.entries(APP_BUILT_WEB_URL))(
    '%s opens only a URL the app built itself (F-480)',
    (relative, expression) => {
      const file = files.find((candidate) => candidate.relative === relative);
      expect(file).toBeDefined();
      const code = stripComments(file!.source);
      // The exemption is earned by WHAT is opened, so assert that and not just the import.
      expect({ opens: expression, matches: code.includes(`Linking.openURL(${expression})`) })
        .toEqual({ opens: expression, matches: true });
      // One call, so the assertion above cannot be satisfied while a second site hides.
      expect(code.match(/Linking\.openURL\s*\(/g)).toHaveLength(1);
    },
  );

  it.each(Object.entries(FORMERLY_EXEMPT))(
    'routes %s through the validating opener, not the OS (F-445)',
    (relative, value) => {
      const file = files.find((candidate) => candidate.relative === relative);
      expect(file).toBeDefined();
      const code = stripComments(file!.source);

      // `value` names the field this screen opens, so a failure reads as
      // "marketplace-detail.tsx still opens payment.data.checkout_url itself".
      expect({ opens: value, rawLinkingCall: /Linking\.openURL\s*\(/.test(code) })
        .toEqual({ opens: value, rawLinkingCall: false });
      expect({ opens: value, callsTheOpener: /openExternalUrl\s*\(/.test(code) })
        .toEqual({ opens: value, callsTheOpener: true });
      expect(code).toContain("from '@/lib/utils/openExternalUrl'");
    },
  );

  it('keeps the helper as the only place that decides which schemes are allowed', () => {
    const helper = fs.readFileSync(path.join(MOBILE_ROOT, 'lib/utils/openExternalUrl.ts'), 'utf8');
    expect(helper).toContain("const WEB_SCHEMES = ['http:', 'https:']");
  });
});
