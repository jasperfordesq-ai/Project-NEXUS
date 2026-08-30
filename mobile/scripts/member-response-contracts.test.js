// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  validateConnectionStatus,
  validateListingSearch,
  validateMemberSearch,
} = require('./member-response-contracts.cjs');

describe('live member response-contract validators', () => {
  it('accepts populated server-shaped responses', () => {
    expect(() => validateListingSearch({ data: [{ id: 1, title: 'x', description: 'x', type: 'offer', status: 'active', hours_estimate: 1, created_at: 'now', is_favorited: false }], meta: {} })).not.toThrow();
    expect(() => validateMemberSearch({ data: [{ id: 2, name: 'B', first_name: 'B', tagline: null, location: null, created_at: 'now', rating: null, total_hours_given: 0, total_hours_received: 0 }], meta: {} })).not.toThrow();
    expect(() => validateConnectionStatus({ data: { status: 'none', connection_id: null, direction: null } })).not.toThrow();
  });

  it('fails closed on empty fixtures or missing client-consumed fields', () => {
    expect(() => validateListingSearch({ data: [], meta: {} })).toThrow(/fixture item/);
    expect(() => validateMemberSearch({ data: [{ id: 2 }], meta: {} })).toThrow(/missing/);
    expect(() => validateConnectionStatus({ data: { status: 'none' } })).toThrow(/missing/);
  });
});
