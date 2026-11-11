// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BadgeMedallion } from './BadgeMedallion';

describe('BadgeMedallion', () => {
  it('colours two badges of the same kind alike and of different kinds differently', () => {
    const a = render(<BadgeMedallion icon="🌱" kind="exchange" />).container.innerHTML;
    const b = render(<BadgeMedallion icon="🤝" kind="exchange" />).container.innerHTML;
    const c = render(<BadgeMedallion icon="🎉" kind="events" />).container.innerHTML;
    const colourOf = (html: string) => (html.match(/from-(\w+)-100/) ?? [])[1];
    expect(colourOf(a)).toBe(colourOf(b));
    expect(colourOf(a)).not.toBe(colourOf(c));
  });

  it('gives rarer badges a ring and locked badges no colour', () => {
    expect(render(<BadgeMedallion kind="x" rarity="legendary" />).container.querySelector('[data-rarity="legendary"]')).not.toBeNull();
    expect(render(<BadgeMedallion kind="x" rarity="common" />).container.querySelector('[data-rarity]')).toBeNull();
    const locked = render(<BadgeMedallion kind="x" rarity="legendary" earned={false} />).container;
    expect(locked.querySelector('[data-rarity]')).toBeNull();
    expect(locked.innerHTML).toContain('grayscale');
  });
});
