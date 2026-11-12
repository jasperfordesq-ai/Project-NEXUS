// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: in VIVID, no glow lightens a filled panel under its words.
 *
 * The soft glow in a page opening (`.hero-glow`, styles/glass.css) is pinned
 * by hero-glow.contract.test.ts: on a tinted panel it is never darker (light
 * theme) or brighter (dark theme) than the panel, so labels over it keep
 * their contrast.
 *
 * A community that chose "vivid" (warmth phase 5) gets those panels FILLED
 * with the button shade, with white words on the fill (`vivid.panel`,
 * `vivid.text`). White words are held at 4.5:1 against that shade only; a
 * pale glow on top would lighten the fill under them. So in vivid the glow
 * must be gone: every decorative glow carries `vivid.glow`, `vivid.glow` hides
 * it, and no style sheet brings it back.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { vivid } from '@/lib/vivid';

const SRC = path.resolve(__dirname, '..');
const GLASS = fs.readFileSync(path.resolve(SRC, 'styles/glass.css'), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A line that draws a decorative glow patch (absolutely placed, not under
 * the pointer) but would still show in vivid.
 */
export function glowShowsInVivid(line: string): boolean {
  if (!/(?:["'`\s])hero-glow\s/.test(line)) return false;
  const decorative = /data-hero-glow="true"/.test(line) || /hero-glow pointer-events-none/.test(line);
  if (!decorative) return false;
  return !/\$\{vivid\.glow\}/.test(line) && !/(?:^|[\s"'`])vivid:hidden(?=[\s"'`]|$)/.test(line);
}

describe('the glow in vivid', () => {
  it('is hidden by the vivid helper', () => {
    expect(vivid.glow.split(/\s+/)).toContain('vivid:hidden');
  });

  it('is hidden wherever a decorative glow is drawn', () => {
    const offenders: string[] = [];
    let glows = 0;
    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/data-hero-glow="true"|hero-glow pointer-events-none/.test(line)) glows += 1;
        if (glowShowsInVivid(line)) {
          offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${index + 1}`);
        }
      });
    }
    // The page opening (twice), the dashboard, offers and feed welcome panels.
    expect(glows).toBeGreaterThanOrEqual(5);
    expect(offenders, 'add vivid.glow to the glow, see the note at the top of this file').toEqual([]);
  });

  it('is never brought back by a style sheet in vivid', () => {
    for (const sheet of ['glass.css', 'background.css', 'tokens.css']) {
      const css = fs.readFileSync(path.resolve(SRC, 'styles', sheet), 'utf8');
      expect(css, sheet).not.toMatch(/data-colour-strength="vivid"\][^{]*\.hero-glow/);
    }
    expect(GLASS).toMatch(/\.hero-glow\s*\{/);
  });

  it('recognises the fault and its fix', () => {
    expect(glowShowsInVivid('<div aria-hidden="true" data-hero-glow="true" className="hero-glow pointer-events-none absolute" />')).toBe(true);
    expect(glowShowsInVivid('className={`hero-glow pointer-events-none absolute ${classes.glow}`}')).toBe(true);
    expect(glowShowsInVivid('className={`hero-glow pointer-events-none absolute ${classes.glow} ${vivid.glow}`}')).toBe(false);
    expect(glowShowsInVivid('className="hero-glow pointer-events-none absolute vivid:hidden"')).toBe(false);
    // The glow mix used as a panel's own background is not a patch over a fill.
    expect(glowShowsInVivid('className="hero-glow relative overflow-hidden rounded-2xl bg-accent-soft p-4"')).toBe(false);
  });
});
