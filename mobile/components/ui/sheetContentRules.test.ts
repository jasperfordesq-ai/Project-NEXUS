// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 What may live inside a `<BottomSheet>`.
 *
 * Reproduced on the emulator on 2026-09-09, after the owner reported the Goals drawer as
 * "completely malfunctioning": the "Add goal" sheet focused its title field, the keyboard
 * came up, and the description field, the target field and both buttons sat underneath it
 * with no way to reach them. The form had no scroll container at all. Three podcast sheets,
 * the job application sheet and five marketplace sheets had a plain React Native
 * `ScrollView` instead — which HeroUI Native's own documentation says the sheet will
 * intercept, so dragging moved the sheet and never the content.
 *
 * Two rules, both mechanical enough to check from source:
 *
 *  1. No `ScrollView` / `FlatList` from `react-native` between `<BottomSheet` and
 *     `</BottomSheet>`. The wrapper's `scrollable` prop renders the gorhom scroll view that
 *     actually works; a sheet with its own list uses `BottomSheetFlatList` directly.
 *  2. A sheet that contains a text field must be `scrollable` (or carry its own gorhom
 *     list), because the keyboard takes half the screen and whatever is below the focused
 *     field has to be reachable.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '../..');
const SEARCH_DIRS = ['app', 'components'];

const TEXT_FIELD = /<(Input|TextArea|TextInput|FormInput|OrderInput|FilterInput|SearchInput)\b/;
const RN_SCROLLABLE = /<(ScrollView|FlatList|SectionList)\b/;
const GORHOM_SCROLLABLE = /<BottomSheet(ScrollView|FlatList|SectionList|VirtualizedList)\b/;

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

interface SheetBlock {
  file: string;
  line: number;
  openingTag: string;
  body: string;
}

/**
 * Index of the `>` that closes the opening tag starting at `start`.
 *
 * Not `indexOf('>')`: an `onClose={() => …}` prop contains `>` inside braces, and the
 * first version of this test stopped there — so `scrollable`, written after `onClose`,
 * was invisible to it and ten correctly fixed sheets were reported as offenders.
 */
function findTagEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0 && source[i - 1] !== '=') return i;
  }
  return -1;
}

/** Every `<BottomSheet …>…</BottomSheet>` in a file that imports the shared wrapper. */
export function findSheetBlocks(file: string, source: string): SheetBlock[] {
  if (!source.includes("from '@/components/ui/BottomSheet'")) return [];
  const blocks: SheetBlock[] = [];
  const opener = /<BottomSheet(?=[\s>])/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const start = match.index;
    const tagEnd = findTagEnd(source, start);
    if (tagEnd === -1) break;
    const openingTag = source.slice(start, tagEnd + 1);
    if (openingTag.endsWith('/>')) continue;
    const close = source.indexOf('</BottomSheet>', tagEnd);
    if (close === -1) break;
    blocks.push({
      file,
      line: source.slice(0, start).split('\n').length,
      openingTag,
      body: source.slice(tagEnd + 1, close),
    });
    opener.lastIndex = close;
  }
  return blocks;
}

describe('what may live inside a BottomSheet', () => {
  const files = SEARCH_DIRS.flatMap((dir) => collectTsx(dir));
  const blocks = files.flatMap((file) => findSheetBlocks(
    file.replace(/\\/g, '/'),
    fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8'),
  ));

  it('finds sheets to check', () => {
    expect(blocks.length).toBeGreaterThan(15);
  });

  it('never nests a React Native ScrollView or FlatList — the sheet swallows their drag', () => {
    const offenders = blocks
      .filter((block) => RN_SCROLLABLE.test(block.body))
      .map((block) => `${block.file}:${block.line}`);
    expect(offenders).toEqual([]);
  });

  it('makes every sheet that holds a text field scrollable, so the keyboard cannot bury it', () => {
    const offenders = blocks
      .filter((block) => TEXT_FIELD.test(block.body))
      .filter((block) => !GORHOM_SCROLLABLE.test(block.body))
      .filter((block) => !/\bscrollable\b/.test(block.openingTag))
      .map((block) => `${block.file}:${block.line}`);
    expect(offenders).toEqual([]);
  });
});
