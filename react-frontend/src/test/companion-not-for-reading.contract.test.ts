// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `--color-accent` became the community's companion colour on 12 Nov 2026
 * (it was a fixed cyan). Some looks pair a yellow or amber companion, on
 * which white text is under 2:1 and a focus ring under 3:1. So the companion
 * may decorate (borders, glows), but nothing has to be READ on it: words on a
 * fill and keyboard focus rings use `--accent-strong`, which is held at 4.5:1
 * against white for every community colour.
 *
 * Found by the audit of warmth phase 5 (12 Nov 2026): a checked option in the
 * newsletter builder (white on the companion) and the focus ring on the
 * platform's community chooser.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

/** CSS rules (selector { body }) whose body fills with the companion and writes on it. */
export function companionTextRules(css: string): string[] {
  const faults: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = match[2] ?? '';
    const fill = /(?:^|;|\s)background(?:-color)?\s*:\s*var\(--color-accent\)/.test(body);
    const words = /(?:^|;|\s)color\s*:/.test(body);
    if (fill && words) faults.push((match[1] ?? '').trim());
  }
  return faults;
}

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      files(full, ext, out);
    } else if (ext.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the companion colour is never something to read', () => {
  it('no stylesheet writes words on a companion fill', () => {
    const found = files(SRC, /\.css$/).flatMap((file) =>
      companionTextRules(fs.readFileSync(file, 'utf8')).map((rule) => `${path.relative(SRC, file)}: ${rule}`),
    );
    expect(found).toEqual([]);
  });

  it('no keyboard focus ring is drawn in the companion colour', () => {
    const found = files(SRC, /\.tsx?$/).filter((file) =>
      /(?:focus|focus-visible):(?:ring|outline)-\[var\(--color-accent\)\]/.test(fs.readFileSync(file, 'utf8')),
    ).map((file) => path.relative(SRC, file));
    expect(found).toEqual([]);
  });

  it('recognises the fault and leaves decoration alone', () => {
    expect(companionTextRules('.a input:checked + .b { color: #fff; background: var(--color-accent); }')).toEqual(['.a input:checked + .b']);
    expect(companionTextRules('.a { color: #fff; background: var(--accent-strong); }')).toEqual([]);
    expect(companionTextRules('.glow { border-color: var(--color-accent); }')).toEqual([]);
  });
});
