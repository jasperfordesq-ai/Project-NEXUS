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
const SEARCH_DIRS = ['app', 'components'];

/** Relative path → why this call site keeps its own `Linking.openURL`. */
const OWN_HANDLING: Record<string, string> = {
  'app/+not-found.tsx':
    'The last-resort escape for a path this build has no screen for. Catches, and silence is the only option left.',
  'components/FeedItem.tsx':
    'Link preview card. Checks the scheme, and stays silent by design — the card is still readable and there is nothing to recover.',
  'components/courses/LessonContent.tsx':
    'Shows an inline failure state on the lesson itself, which the member can see without a transient toast.',
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
    if (entry.isDirectory()) return sourceFiles(full);
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

const files = SEARCH_DIRS.flatMap((dir) => sourceFiles(path.join(MOBILE_ROOT, dir)));

describe('external links', () => {
  it('finds the files it is meant to police', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('opens every external link through the shared helper, or says why not', () => {
    const raw = files
      .filter(({ source }) => /Linking\.openURL\s*\(/.test(stripComments(source)))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in OWN_HANDLING));

    expect(raw).toEqual([]);
  });

  it('carries no allowlist entry for a file that no longer opens a link', () => {
    const byPath = new Map(files.map((file) => [file.relative, file]));
    const stale = Object.keys(OWN_HANDLING).filter((relative) => {
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
