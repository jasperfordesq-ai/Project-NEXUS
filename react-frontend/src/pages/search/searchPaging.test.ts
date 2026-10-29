// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { searchNextCursor } from './searchPaging';

describe('searchNextCursor', () => {
  it('returns the cursor only for a one-type search with more results', () => {
    expect(searchNextCursor({ pagination: { has_more: true, cursor: 'bzozMA==' } }, { type: 'listings' })).toBe('bzozMA==');
    expect(searchNextCursor({ pagination: { has_more: true, cursor: 'bzozMA==' } }, { type: 'all' })).toBeNull();
    expect(searchNextCursor({ pagination: { has_more: false, cursor: null } }, { type: 'events' })).toBeNull();
    expect(searchNextCursor(undefined, { type: 'users' })).toBeNull();
  });
});
