// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { joinTitle } from './joinTitle';

describe('joinTitle', () => {
  it('appends the site name to an ordinary page title', () => {
    expect(joinTitle('Events', 'TimeBank Ireland', 'TimeBank Ireland')).toBe('Events | TimeBank Ireland');
  });

  it('returns the site name alone when there is no page title', () => {
    expect(joinTitle(undefined, 'TimeBank Ireland')).toBe('TimeBank Ireland');
    expect(joinTitle('   ', 'TimeBank Ireland')).toBe('TimeBank Ireland');
  });

  it('does not repeat a site name the title already contains', () => {
    expect(joinTitle('About TimeBank Ireland', 'TimeBank Ireland')).toBe('About TimeBank Ireland');
  });

  it('compares case- and whitespace-insensitively', () => {
    expect(joinTitle('About Timebank  ireland', 'TimeBank Ireland')).toBe('About Timebank  ireland');
    expect(joinTitle('About Time Bank Ireland', 'TimeBank Ireland')).toBe('About Time Bank Ireland');
  });

  it('also skips the suffix when the title names the branding name', () => {
    // Admin title suffix differs from the community's branding name.
    expect(joinTitle('Welcome to hOUR Timebank', 'Timebank Ireland', 'hOUR Timebank')).toBe(
      'Welcome to hOUR Timebank',
    );
  });

  it('ignores an empty branding name', () => {
    expect(joinTitle('About', 'Timebank Ireland', '')).toBe('About | Timebank Ireland');
    expect(joinTitle('About', 'Timebank Ireland', null)).toBe('About | Timebank Ireland');
  });
});
