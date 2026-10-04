// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { isHexColor, readableHeaderText } from './headerPreview';

describe('readableHeaderText', () => {
  it('uses white text on dark backgrounds and near-black on light ones', () => {
    expect(readableHeaderText('#0b0c0c')).toBe('#ffffff');
    expect(readableHeaderText('#0053be')).toBe('#ffffff');
    expect(readableHeaderText('#ffffff')).toBe('#0b0c0c');
    expect(readableHeaderText('#ffdd00')).toBe('#0b0c0c');
  });

  it('accepts a missing hash and falls back to white for anything unparseable', () => {
    expect(readableHeaderText('0b0c0c')).toBe('#ffffff');
    expect(readableHeaderText('')).toBe('#ffffff');
    expect(readableHeaderText('#abc')).toBe('#ffffff');
  });
});

describe('isHexColor', () => {
  it('matches only full six-digit hex codes', () => {
    expect(isHexColor('#1d70b8')).toBe(true);
    expect(isHexColor('1D70B8')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });
});
