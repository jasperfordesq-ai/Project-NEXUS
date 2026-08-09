// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  compactResult,
  MAX_COMPACT_DETAIL_LENGTH
} = require('../scripts/laravel-runtime-smoke-local-server');

describe('local Laravel runtime smoke output', () => {
  test('compact output keeps every failure but bounds large diagnostic details', () => {
    const oversizedDetail = 'x'.repeat(MAX_COMPACT_DETAIL_LENGTH + 37);
    const result = compactResult({
      ok: false,
      checks: [
        { ok: true, name: 'passing check', detail: 'not emitted' },
        { ok: false, name: 'large failure', status: 500, path: '/feed', text: oversizedDetail, detail: oversizedDetail },
        { ok: false, name: 'small failure', location: '/login', detail: 'redirect mismatch' }
      ]
    });

    expect(result).toEqual({
      ok: false,
      total: 3,
      failed: [
        {
          name: 'large failure',
          status: 500,
          path: '/feed',
          detail: `${'x'.repeat(MAX_COMPACT_DETAIL_LENGTH)}... [truncated 37 characters]`
        },
        {
          name: 'small failure',
          location: '/login',
          detail: 'redirect mismatch'
        }
      ]
    });
  });
});
