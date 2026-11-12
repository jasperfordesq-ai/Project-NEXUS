// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: in VIVID, words on a cover sit on a solid chip.
 *
 * A cover (ThemedCover, and CoverTile / DetailCover, which draw one) stands in
 * for a photo. In soft colour strength it is a pale tint, and its label sits on
 * a frosted pill. A community that chose "vivid" (warmth phase 5) gets covers
 * at full strength — a mid shade of the cover's own colour, which no text
 * colour reads on for every hue. So in vivid:
 *   - every word on a cover sits on the vivid chip (`vivid.chip`: a white pill,
 *     the community's button shade as its text — 4.5:1 by construction), with
 *     no dark-theme background left on it that could beat the white;
 *   - the picture sits on an opaque tile, not a see-through frosted one.
 * CoverTile and DetailCover draw no words today; if one ever does, this fails
 * until the words are on the chip.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import Users from 'lucide-react/icons/users';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { CoverTile } from '@/components/ui/CoverTile';
import { DetailCover } from '@/components/ui/DetailCover';
import { SiteVividContext } from '@/contexts/SiteAccentContext';
import { HUE_WHEEL } from '@/lib/categoryColours';
import { vivid } from '@/lib/vivid';

const CHIP = vivid.chip.split(/\s+/);

function renderVivid(element: ReactElement) {
  return render(createElement(SiteVividContext.Provider, { value: true }, element));
}

/** Every piece of text in `root` whose nearest element is not on the vivid chip. */
function wordsOffTheChip(root: HTMLElement): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (!text) continue;
    let element = node.parentElement;
    let onChip = false;
    while (element && root.contains(element)) {
      const classes = element.className.split(/\s+/);
      if (CHIP.every((token) => classes.includes(token))) {
        onChip = !classes.some((c) => /^dark:bg-/.test(c));
        break;
      }
      element = element.parentElement;
    }
    if (!onChip) offenders.push(text);
  }
  return offenders;
}

/** A see-through or frosted background in a class list. */
const SEE_THROUGH = /(?:^|\s)(?:[\w:-]+:)?(?:bg-[\w-]+\/\d+|backdrop-blur[\w-]*)(?=\s|$)/;

describe('words on a cover in vivid', () => {
  it.each([...HUE_WHEEL.map(({ name }) => name), 'slate'])('a %s cover puts its label on the vivid chip', (colour) => {
    const { container } = renderVivid(createElement(ThemedCover, { colour, icon: Users, label: 'Gardening', seed: 'x' }));
    expect(container.textContent).toContain('Gardening');
    expect(wordsOffTheChip(container)).toEqual([]);
  });

  it('a large cover with a long label does the same', () => {
    const { container } = renderVivid(createElement(ThemedCover, { colour: 'yellow', size: 'lg', icon: Users, label: 'Home and garden repairs' }));
    expect(wordsOffTheChip(container)).toEqual([]);
  });

  it('a list tile and a page band put any words on the chip too', () => {
    const tile = renderVivid(createElement(CoverTile, { seed: 'org-1', icon: Users, name: 'Riverside Growers', className: 'h-12 w-12' }));
    expect(wordsOffTheChip(tile.container)).toEqual([]);
    tile.unmount();
    const band = renderVivid(createElement(DetailCover, { seed: 'course-1', icon: Users }));
    expect(wordsOffTheChip(band.container)).toEqual([]);
  });

  it('puts the picture on an opaque tile', () => {
    const { container } = renderVivid(createElement(ThemedCover, { colour: 'green', icon: Users, label: 'Gardening' }));
    const tile = container.querySelector('[data-cover-icon]');
    expect(tile).not.toBeNull();
    expect(tile!.className).not.toMatch(SEE_THROUGH);
  });

  it('recognises a label that is off the chip', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><span class="rounded-full bg-white/75 px-2">Gardening</span></div>';
    expect(wordsOffTheChip(root)).toEqual(['Gardening']);
    root.innerHTML = `<div><span class="rounded-full dark:bg-black/30 ${vivid.chip}">Gardening</span></div>`;
    expect(wordsOffTheChip(root)).toEqual(['Gardening']);
    root.innerHTML = `<div><span class="rounded-full bg-white/75 ${vivid.chip}">Gardening</span></div>`;
    expect(wordsOffTheChip(root)).toEqual([]);
    expect(SEE_THROUGH.test('rounded-2xl bg-white/55 ring-1')).toBe(true);
    expect(SEE_THROUGH.test('rounded-2xl bg-white dark:bg-black/40')).toBe(true);
    expect(SEE_THROUGH.test('rounded-2xl bg-white shadow-sm')).toBe(false);
  });
});
