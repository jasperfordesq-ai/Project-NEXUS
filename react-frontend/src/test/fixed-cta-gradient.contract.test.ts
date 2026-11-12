// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: a main button follows the community colour.
 *
 * A community chooses its own colour (ThemeContext). Main buttons carry it as
 * `bg-gradient-to-r from-accent-strong to-accent-strong-end text-white`. Until
 * 12 Nov 2026, 36 of them were painted in a fixed blend instead — the welcome
 * steps were green, polls amber, the terms page blue — so a community with a
 * red colour met green buttons on the very first screens a new member sees.
 *
 * So: white text never sits on a fixed-hue `from-<hue>-500…900` blend on the
 * member website, except where the colour carries a meaning of its own. Those
 * places are listed below with the reason, and the list may only shrink.
 *
 * Not covered here: the admin and broker panels (their own look), and Caring
 * Community (never touched).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const NOT_TOUCHED = ['admin', 'broker', 'caring-community', 'test', '__tests__'];

const HUES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// "text-white/90" (see-through white) is white text too.
const WHITE_TEXT = /(^|[\s"'`{}:!])text-white(?:\/\d{1,3})?!?(?=[\s"'`{}]|$)/;
const FIXED_BLEND = new RegExp(`(^|[\\s"'\`{}:])from-(?:${HUES})-(?:[5-9]00|950)(?=[\\s"'\`{}/!]|$)`);

/**
 * Fixed-colour white-text blends that are deliberate, by file: how many, and why.
 * Shrink-only — an entry that no longer occurs must be removed (the test fails
 * in both directions).
 */
const MEANING: Record<string, { count: number; why: string }> = {
  'components/feed/FeedCard.tsx': { count: 1, why: 'event date tile: the fixed colour for events (kindColour)' },
  'components/layout/SourceRepositoryLink.tsx': { count: 1, why: 'AGPL attribution badge: platform mark, not community' },
  'components/legal/PlatformLegalPage.tsx': { count: 1, why: "the platform's own terms, not a community page" },
  'pages/achievements/AchievementsPage.tsx': { count: 1, why: 'green = claim a reward you have earned (success)' },
  'pages/goals/GoalsPage.tsx': { count: 1, why: 'green = mark a goal complete (success)' },
  'pages/volunteering/ShiftSwapsTab.tsx': { count: 1, why: 'green = accept a swap (success)' },
  'pages/volunteering/EmergencyAlertsTab.tsx': { count: 1, why: 'green = accept an urgent shift (success)' },
  'pages/volunteering/ReportIncidentModal.tsx': { count: 1, why: 'amber = report an incident (warning)' },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (NOT_TOUCHED.includes(entry.name)) continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function offendsOn(line: string): boolean {
  return WHITE_TEXT.test(line) && FIXED_BLEND.test(line);
}

/** Every className value: a quoted string, or a {...} expression with balanced braces. */
function classNameChunks(source: string): string[] {
  const chunks: string[] = [];
  const re = /className=/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const open = source[start];
    if (open === '"' || open === "'") {
      const end = source.indexOf(open, start + 1);
      if (end > start) chunks.push(source.slice(start, end + 1));
    } else if (open === '{') {
      let depth = 0;
      let i = start;
      for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
      }
      chunks.push(source.slice(start, i + 1));
    }
  }
  return chunks;
}

/**
 * Offending lines, plus class lists split over several lines (cn(), clsx(),
 * template strings) that offend as a whole while no single line does.
 */
export function offendingCount(source: string): number {
  const lines = source.split('\n').filter(offendsOn).length;
  const split = classNameChunks(source).filter((chunk) => chunk.includes('\n')
    && offendsOn(chunk.replace(/\s+/g, ' '))
    && !chunk.split('\n').some(offendsOn)).length;
  return lines + split;
}

describe('main buttons follow the community colour', () => {
  it('never paints white text on a fixed-colour blend, except where the colour has a meaning', () => {
    const found: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const hits = offendingCount(fs.readFileSync(file, 'utf8'));
      if (hits > 0) found[path.relative(SRC, file).split(path.sep).join('/')] = hits;
    }
    const expected = Object.fromEntries(Object.entries(MEANING).map(([file, { count }]) => [file, count]));
    expect(found, 'use from-accent-strong to-accent-strong-end; see the note at the top of this file').toEqual(expected);
  });

  it('recognises the fault and its fix', () => {
    expect(offendsOn("className=\"bg-gradient-to-r from-emerald-700 to-teal-700 text-white\"")).toBe(true);
    expect(offendsOn("'data-[selected=true]:from-amber-700 data-[selected=true]:to-orange-700 data-[selected=true]:text-white!'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-blue-600 to-cyan-700 text-white'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'")).toBe(false);
    // Soft decorative tints carry no white text.
    expect(offendsOn("'bg-gradient-to-br from-emerald-500/20 to-teal-500/20'")).toBe(false);
    expect(offendsOn("'from-emerald-100 to-teal-100 text-white'")).toBe(false);
  });

  // The first version missed these (audit of warmth phase 5, 12 Nov 2026).
  it('also recognises indigo and purple, the darkest shades, and see-through white text', () => {
    expect(offendsOn("'bg-gradient-to-r from-indigo-600 to-purple-600 text-white'")).toBe(true);
    expect(offendsOn("'bg-linear-to-r from-purple-500 to-pink-500 text-white'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-slate-950 to-slate-800 text-white'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-blue-700 to-cyan-700 text-white/90'")).toBe(true);
    expect(offendsOn("'from-accent-strong to-accent-strong-end text-white/90'")).toBe(false);
  });

  it('sees a class list split over several lines as one', () => {
    const source = [
      '<Button',
      '  className={cn(',
      "    'bg-gradient-to-r from-blue-600 to-cyan-700',",
      "    'text-white shadow-sm',",
      '  )}',
      '/>',
      "<p className=\"text-white\">Fine: no fixed blend here</p>",
      "<div className=\"from-blue-600/20 to-cyan-700/20\" />",
    ].join('\n');
    expect(offendingCount(source)).toBe(1);
    expect(offendingCount("<a className=\"bg-gradient-to-r from-blue-600 to-cyan-700 text-white\" />")).toBe(1);
  });
});
