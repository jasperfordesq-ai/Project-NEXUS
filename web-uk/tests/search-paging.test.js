// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Laravel pages a search of one type since 29 Oct 2026 (meta.pagination);
 * the accessible search pages offer "Load more" only then.
 */

const { nextSearchCursor } = require('../src/routes/search');

const page = (pagination) => ({ data: [], meta: { pagination } });

it('offers the next page only for a one-type search that has more', () => {
  expect(nextSearchCursor(page({ has_more: true, cursor: 'bzozMA==' }), 'listings')).toBe('bzozMA==');
  expect(nextSearchCursor(page({ has_more: true, cursor: 'bzozMA==' }), 'all')).toBe('');
  expect(nextSearchCursor(page({ has_more: false, cursor: null }), 'listings')).toBe('');
  expect(nextSearchCursor({ data: [] }, 'events')).toBe('');
});

it('ignores a cursor that is not a plain token', () => {
  expect(nextSearchCursor(page({ has_more: true, cursor: '"><script>' }), 'users')).toBe('');
});
