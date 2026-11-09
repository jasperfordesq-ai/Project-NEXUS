// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { joinList } from './listFormat';

describe('joinList', () => {
  it('joins names the way the reader’s language does', () => {
    expect(joinList(['Maeve', 'Tom', 'Ann'], 'en')).toBe('Maeve, Tom, and Ann');
    expect(joinList(['Maeve', 'Tom'], 'en')).toBe('Maeve and Tom');
    expect(joinList(['Maeve', 'Tom'], 'de')).toBe('Maeve und Tom');
  });

  it('copes with one name and with none', () => {
    expect(joinList(['Maeve'], 'en')).toBe('Maeve');
    expect(joinList([], 'en')).toBe('');
  });

  it('falls back to a comma list for a locale it cannot read', () => {
    expect(joinList(['Maeve', 'Tom'], 'not a locale!!')).toBe('Maeve, Tom');
  });
});
