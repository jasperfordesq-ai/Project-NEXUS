// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shrink-only migration of `Chip` onto the accessibility-aware wrapper.
 *
 * 🔴 `heroui-native`'s Chip renders a `Pressable` whether or not it was given an
 * `onPress`, so an informational chip — "1 conversation", "0 unread", "3 results",
 * "No pending credits", a status, a category — reaches the accessibility tree as a
 * control a screen-reader user is invited to activate, and which does nothing.
 *
 * `@/components/ui/StatusChip` fixes that, verified on a device with TalkBack on
 * 2026-08-23: the messages screen went from 17 reported controls to 12, and the wallet
 * from 9 to 6, purely by removing chips that were never actions.
 *
 * The remaining files are a queue, not an exemption. Migrating one is a single import
 * line; lower BUDGET by the same number in the same commit.
 *
 * 🔴 Not migrated wholesale in one commit on purpose: the import is one line per file but
 * each file needs its chips looked at, because a chip that IS interactive must keep
 * behaving as a control and only a device check proves the difference.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Measured 2026-08-23 after migrating the six screens audited with TalkBack; lowered to 77
 * on 2026-08-24, evidence-led.
 *
 * 🔴 The fourteen files migrated that day were not picked by taste.
 * `scripts/audit-touch-targets.mjs` measured 24 screens and found **33** touch targets below
 * the WCAG 2.2 AA minimum — and every single one was an informational chip 20dp tall:
 * "5 members", "Not ID verified", "2 members", "0 posts", "Public", "Joined", "Timebank",
 * "Closes Sep 22, 2026", "48 unread", "2 votes", "You voted", "0 downloads". Migrating a
 * file stops its informational chips being touch targets at all, which is why the audit and
 * this budget move together: the member card and directory, the verification badges, and the
 * jobs, marketplace, notifications, profile, resources, polls, events and volunteering
 * screens.
 */
const BUDGET = 72;

function collectTsx(dir: string, out: string[] = []): string[] {
  const abs = path.join(MOBILE_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectTsx(rel, out);
      continue;
    }
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
    out.push(rel);
  }
  return out;
}

function importsChipDirectly(source: string): boolean {
  const match = source.match(/import \{([^}]*)\} from 'heroui-native';/);
  if (!match) return false;
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .includes('Chip');
}

describe('Chip migration onto the accessibility-aware wrapper', () => {
  const files = [...collectTsx(SEARCH_DIRS[0]), ...collectTsx(SEARCH_DIRS[1])];

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('does not grow the number of files importing Chip straight from heroui-native', () => {
    const remaining = files.filter((file) =>
      importsChipDirectly(fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8')),
    );

    expect(remaining.length).toBeLessThanOrEqual(BUDGET);
  });

  it('keeps the screens verified with TalkBack on the wrapper', () => {
    const verified = [
      'app/(tabs)/home.tsx',
      'app/(tabs)/exchanges.tsx',
      'app/(modals)/wallet.tsx',
      'app/(tabs)/messages.tsx',
      'components/FeedItem.tsx',
      'components/ExchangeCard.tsx',
      'app/(modals)/exchange-requests.tsx',
      'app/(modals)/goals.tsx',
      'app/(modals)/goal-detail.tsx',
      'app/(modals)/organisations.tsx',
      'app/(modals)/settings.tsx',
      'app/(auth)/select-tenant.tsx',
    ];
    for (const file of verified) {
      const source = fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      expect(importsChipDirectly(source)).toBe(false);
      expect(source).toContain("from '@/components/ui/StatusChip'");
    }
  });
});
