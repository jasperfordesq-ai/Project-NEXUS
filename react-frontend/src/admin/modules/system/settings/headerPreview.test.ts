// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { DEFAULT_HEADER_ACCENT, defaultHeaderLineColour, headerLineColour, isHexColor, readableHeaderText } from './headerPreview';

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

// The accessible site draws its header line in the community colour when no
// header colour is chosen (web-uk/src/lib/accessible-shell.js, 10 Nov 2026);
// the admin preview must show the same line.
describe('headerLineColour', () => {
  it('uses the chosen line colour first', () => {
    expect(headerLineColour({ header_accent_color: '#ffffff', header_bg_color: '#5b2a86', community_color: '#c2185b' })).toBe('#ffffff');
  });

  it('matches the header colour when no line colour is chosen', () => {
    expect(headerLineColour({ header_accent_color: '', header_bg_color: '#5b2a86', community_color: '#c2185b' })).toBe('#5b2a86');
  });

  it('uses the community colour when neither header colour is chosen', () => {
    expect(headerLineColour({ header_accent_color: '', header_bg_color: '', community_color: '#C2185B' })).toBe('#c2185b');
    expect(defaultHeaderLineColour({ header_bg_color: '', community_color: '#c2185b' })).toBe('#c2185b');
  });

  it('falls back to the standard blue, and ignores anything that is not #rrggbb', () => {
    expect(headerLineColour({ header_accent_color: '', header_bg_color: '', community_color: '' })).toBe(DEFAULT_HEADER_ACCENT);
    expect(headerLineColour({ header_accent_color: 'red', header_bg_color: 'c2185b', community_color: 'red;x' })).toBe(DEFAULT_HEADER_ACCENT);
  });
});
