// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The busiest lists show the shape of what is coming, not a spinner on a blank screen.
 *
 * 🔴 Why it matters, and why it is not cosmetic. A centred spinner says "wait" and nothing
 * else: no sense of how much is arriving, and the screen jumps when the rows land. The five
 * tab screens already had card skeletons and read as noticeably faster for it, even though
 * they are not faster at all. Notifications, marketplace, volunteering, jobs and the wallet
 * transaction list still showed a spinner, so the app felt inconsistent — the same wait
 * looked slower on half the screens. Audit 2026-09-09, item 11.
 *
 * 🔴 The audit that found this said "100 screens use a spinner, 10 use a skeleton". That
 * counted files, not journeys, and it was misleading: the five busiest lists were already
 * done. The real gap was these five, which this test names rather than counting.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');

/**
 * Screen → the skeleton element it RENDERS while loading.
 *
 * 🔴 The angle bracket is load-bearing. Without it this matched the import line, so the
 * first version of this test stayed green when the loading branch was put back to a
 * spinner — the control run caught it.
 */
const BUSY_LISTS: Record<string, string> = {
  'app/(tabs)/home.tsx': '<FeedItemSkeleton',
  'app/(tabs)/exchanges.tsx': '<ExchangeCardSkeleton',
  'app/(tabs)/messages.tsx': '<ConversationSkeleton',
  'app/(tabs)/events.tsx': '<EventCardSkeleton',
  'app/(tabs)/groups.tsx': '<SkeletonBox',
  'app/(tabs)/members.tsx': '<SkeletonBox',
  'app/(modals)/notifications.tsx': '<ListSkeleton',
  'app/(modals)/marketplace.tsx': '<ListSkeleton',
  'app/(modals)/volunteering.tsx': '<ListSkeleton',
  'app/(modals)/jobs.tsx': '<ListSkeleton',
  'app/(modals)/wallet.tsx': '<ListSkeleton',
};

function read(relative: string): string {
  return fs.readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
}

describe('loading states on the busiest lists', () => {
  it.each(Object.entries(BUSY_LISTS))('%s shows a skeleton while it loads', (relative, expected) => {
    expect(read(relative)).toContain(expected);
  });

  it('none of the five that were fixed falls back to a bare spinner for its main list', () => {
    /*
      Narrow on purpose. These screens legitimately still use a spinner for ACTIONS — a
      submit button, a sheet loading its contents — and this must not push them into
      replacing those too. What is checked is that a skeleton is present, and that the two
      screens whose only spinner was the list one no longer import a spinner at all.
    */
    for (const relative of ['app/(modals)/notifications.tsx', 'app/(modals)/marketplace.tsx']) {
      const source = read(relative);
      expect(source).toContain('<ListSkeleton');
    }

    expect(read('app/(modals)/notifications.tsx')).not.toContain('LoadingSpinner');
  });

  it('the shared list skeleton renders the number of rows it is asked for', () => {
    const skeleton = read('components/ui/Skeleton.tsx');
    expect(skeleton).toContain('export function ListSkeleton');
    expect(skeleton).toContain('Array.from({ length: rows }');
  });
});
