// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Doodle, DOODLE_NAMES } from './Doodle';

describe('Doodle (Open Doodles drawings, warmth plan C2)', () => {
  it('draws the highlight in the community colour and the lines in the text colour', async () => {
    const { container } = render(<Doodle name="coffee" />);
    const svg = container.querySelector('svg[data-doodle="coffee"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => expect(svg?.querySelectorAll('path').length).toBeGreaterThan(1));
    const accent = svg?.querySelector('[data-doodle-part="accent"]');
    expect(accent?.getAttribute('fill')).toBe('var(--accent)');
    expect(svg?.querySelector('[data-doodle-part="ink"]')?.getAttribute('fill')).toBe('currentColor');
  });

  it('keeps its shape while the drawing loads, so nothing jumps', () => {
    const { container } = render(<Doodle name="float" />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1024 768');
  });

  it('offers exactly the drawings that are on disk, and each names its CC0 source', () => {
    const dir = resolve(__dirname, 'doodles');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'types.ts');
    expect(files.map((f) => f.replace(/\.ts$/, '')).sort()).toEqual([...DOODLE_NAMES].sort());
    for (const f of files) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      expect(text).toContain('Open Doodles by Pablo Stanley');
      expect(text).toContain('CC0');
    }
  });
});
