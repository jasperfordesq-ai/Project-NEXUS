// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard against a card-sized body being cropped by the button wrapping it.
 *
 * 🔴 `HeroButton` caps its own height. A `Surface` or `HeroCard` used as a whole-row tap
 * target therefore renders only as much of itself as the button's height allows, and the
 * rest is not drawn — no error, no warning, no ellipsis. It has now cost two separate
 * member-facing defects:
 *
 *   • Notification cards (fixed 2026-08-22) lost their title, category chip and timestamp
 *     entirely, and the body was cut mid-word.
 *   • Wallet transaction rows (fixed 2026-08-23) lost the description AND the amount, so a
 *     row showed an avatar, a name and a date — while walking pending credits, the two
 *     rows the member had asked to see were the two rows they could not read.
 *
 * Both were found by looking at a screenshot. Jest has no layout engine, so no component
 * test can see it; hence a source scan.
 *
 * 🔴 A hit is NOT proof of a defect. Whether the content is cropped depends on rendered
 * height, exactly as with the `SafeAreaView` flex family — a short one-line card inside a
 * button is fine. So this is a shrink-only ratchet over the remaining sites rather than a
 * zero-tolerance rule: it stops the pattern spreading, and each removal must lower BUDGET
 * in the same commit.
 *
 * The fix is `components/ui/NativePressable`, which lets its content decide the height.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Remaining sites, measured 2026-08-23. Shrink only: convert one to NativePressable and
 * lower this number in the same commit.
 */
const BUDGET = 8;

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
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.test.')) continue;
    out.push(rel);
  }
  return out;
}

function findCardsInsideButtons(source: string): number[] {
  const lines: number[] = [];
  const opener = /<HeroButton\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const close = source.indexOf('</HeroButton>', match.index);
    if (close === -1) continue;
    const body = source.slice(match.index, close);
    if (/<(Surface|HeroCard)\b/.test(body)) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

describe('a card-sized tap target is not wrapped in a height-capping button', () => {
  const files = [...collectTsx(SEARCH_DIRS[0]), ...collectTsx(SEARCH_DIRS[1])];

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('does not grow the number of cards wrapped in HeroButton', () => {
    const hits: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      for (const line of findCardsInsideButtons(source)) {
        hits.push(`${file.split(path.sep).join('/')}:${line}`);
      }
    }

    expect(hits.length).toBeLessThanOrEqual(BUDGET);
  });

  it('keeps the two repaired families on NativePressable', () => {
    // The wallet transaction row and the notification card are the two that were proven
    // to crop on a device. Neither may go back inside a button.
    for (const file of ['app/(modals)/wallet.tsx', 'app/(modals)/notifications.tsx']) {
      const source = fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      expect(source).toContain("from '@/components/ui/NativePressable'");
    }

    const wallet = fs.readFileSync(path.join(MOBILE_ROOT, 'app/(modals)/wallet.tsx'), 'utf8');
    const rowStart = wallet.indexOf('function TransactionCard(');
    expect(rowStart).toBeGreaterThan(-1);
    const rowBody = wallet.slice(rowStart, wallet.indexOf('\nfunction ', rowStart + 10));
    expect(rowBody).toContain('<NativePressable');
    expect(rowBody).not.toContain('<HeroButton');
  });
});
