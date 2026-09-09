// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A picture that comes from the server is drawn by `RemoteImage`, which has a failure state.
 *
 * 🔴 What a bare `<Image>` does when the load fails: nothing. No `onError` existed anywhere
 * in the app, so a photo that 404s — a deleted upload, a community whose uploads directory
 * is misconfigured, a phone that lost signal mid-scroll — rendered as a blank rectangle the
 * exact size of the picture. On a card that leaves a hole above the title which nothing
 * explains, and it reads as "the app is broken" rather than "this picture is missing".
 *
 * `RemoteImage` was written for this in the 2026-09-07 audit and then adopted almost
 * nowhere: twenty-four files still imported `Image` directly and not one of them handled an
 * error. Thirteen of those showed SERVER pictures and are migrated. Audit 2026-09-09, item 13.
 *
 * The surrounding `{url ? … : fallback}` conditionals are kept on purpose, so each screen's
 * own branded "no picture at all" state survives. What changes is the FAILED load.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Files still allowed to render a raw `<Image>`, and why.
 *
 * All of these show something local or take their own care — none of them is a server photo
 * on a card, which is the case that produced blank holes.
 */
const RAW_IMAGE_ALLOWED: Record<string, string> = {
  'components/ui/RemoteImage.tsx': 'The implementation. It is the thing that adds onError.',
  'components/ui/ImageCarousel.tsx': 'Carries its own per-slide loading and error handling.',
  'components/TenantBanner.tsx': 'The community logo, which the tenant config guarantees.',
  'app/(auth)/select-tenant.tsx': 'Community logos on the picker, each with a lettered fallback beside it.',
  'app/(modals)/image-viewer.tsx': 'The full-screen lightbox: a zoomable single image with its own states.',
  'app/(modals)/edit-exchange.tsx': 'Local preview of a photo the member just picked, before upload.',
  'app/(modals)/new-event.tsx': 'Local preview of a photo the member just picked.',
  'app/(modals)/new-exchange.tsx': 'Local preview of a photo the member just picked.',
  'app/(modals)/new-group.tsx': 'Local preview of a photo the member just picked.',
  'app/(modals)/new-marketplace-listing.tsx': 'Local previews of photos the member just picked.',
  'app/(modals)/marketplace-merchant-onboarding.tsx': 'Local preview of the logo just picked.',
  'app/(modals)/onboarding.tsx': 'Local preview of the avatar just picked.',
  'app/(modals)/thread.tsx':
    'Two cases, neither a plain server url: a local preview of an attachment being sent, and a message image fetched as a source OBJECT with auth headers, which RemoteImage (uri-only) cannot express.',
};

function sourceFiles(dir: string): { relative: string; source: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) return [];
    return [{
      relative: path.relative(MOBILE_ROOT, full).split(path.sep).join('/'),
      source: fs.readFileSync(full, 'utf8'),
    }];
  });
}

const files = SEARCH_DIRS.flatMap((dir) => sourceFiles(path.join(MOBILE_ROOT, dir)));

describe('remote pictures have a failure state', () => {
  it('finds the files it is meant to police', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('no screen renders a bare Image without a documented reason', () => {
    const raw = files
      .filter(({ source }) => /<Image[\s/>]/.test(source))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in RAW_IMAGE_ALLOWED));

    expect(raw).toEqual([]);
  });

  it('carries no allowlist entry for a file that no longer renders one', () => {
    const byPath = new Map(files.map((file) => [file.relative, file]));
    const stale = Object.keys(RAW_IMAGE_ALLOWED).filter((relative) => {
      const file = byPath.get(relative);
      return !file || !/<Image[\s/>]/.test(file.source);
    });

    expect(stale).toEqual([]);
  });

  it('RemoteImage still handles the error it exists for', () => {
    const source = fs.readFileSync(path.join(MOBILE_ROOT, 'components/ui/RemoteImage.tsx'), 'utf8');
    expect(source).toContain('onError=');
    expect(source).toContain('setFailed(true)');
  });
});

/**
 * 🔴 Rows in a long list are memoised. Only `FeedItem` was, so scrolling the members,
 * listings or marketplace lists re-rendered every visible row whenever the parent screen
 * updated — which it does on every filter change, refresh and page append.
 */
describe('list rows are memoised', () => {
  it.each([
    'components/FeedItem.tsx',
    'components/MemberCard.tsx',
    'components/ExchangeCard.tsx',
    'components/marketplace/MarketplaceListingCard.tsx',
  ])('%s is wrapped in memo', (relative) => {
    const source = fs.readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
    expect(source).toMatch(/=\s*memo\(/);
  });
});
