// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A width class on `<Input className>` does nothing, and the field looks correct.
 *
 * `components/ui/Input.tsx` renders two nested elements:
 *
 *     <TextField className={containerClassName ?? 'mb-3'}>   <- this is what SIZES
 *       <View className="flex-row items-center">
 *         <HeroInput className={inputClassName ?? 'flex-1'} {...rest} />   <- className lands here
 *
 * A caller's `className` is spread through `...rest` onto the inner HeroInput, so
 * `flex-1` there makes the input fill its own container — and the container is still
 * sized by its content, because it never received the class.
 *
 * Found on a device on 2026-08-20 walking the volunteering expenses form: the amount box
 * rendered roughly 40dp wide, too narrow to display "12.50", while the source read
 * `className="flex-1 text-base"` and looked entirely reasonable. Both the expenses and
 * donations rows had it, for the amount and the currency.
 *
 * This is the third distinct way `flex-1` silently does nothing in this app, after the
 * inert SafeAreaView (`components/safeAreaFlex.test.ts`) and a full-width card wrapped in
 * a HeroButton (`app/(auth)/select-tenant.tsx`). The pattern is always the same: the class
 * is on a different element from the one that decides the size.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');

/** Classes that only have an effect on the OUTER container. */
const LAYOUT_CLASS = /^(flex-1|basis-|w-|min-w-|max-w-)/;

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
        found.push(full);
      }
    }
  };
  for (const root of ['app', 'components']) walk(path.join(MOBILE_ROOT, root));
  return found;
}

describe('Input width classes go where they can take effect', () => {
  it('finds Input usages at all, so a silent zero cannot pass', () => {
    const total = sourceFiles().filter((f) => /<Input\b/.test(fs.readFileSync(f, 'utf8'))).length;
    expect(total).toBeGreaterThan(10);
  });

  it('never sizes an Input through className', () => {
    const problems: string[] = [];

    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(/<Input\b[^>]*?>/gs)) {
        const tag = match[0];
        // Only a bare `className`, not containerClassName / inputClassName.
        const className = /(?<!container)(?<!input)className="([^"]*)"/.exec(tag);
        if (!className) continue;

        const offenders = className[1].split(/\s+/).filter((c) => LAYOUT_CLASS.test(c));
        if (!offenders.length) continue;

        const line = src.slice(0, match.index).split('\n').length;
        const rel = path.relative(MOBILE_ROOT, file).replace(/\\/g, '/');
        problems.push(`${rel}:${line} — ${offenders.join(', ')} must be on containerClassName`);
      }
    }

    expect(problems).toEqual([]);
  });
});
