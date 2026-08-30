// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  validateConnectionStatus,
  validateCanonicalEvents,
  validateListingSearch,
  validateMarketplaceSearch,
  validateMatchesPayload,
  validateMemberSearch,
  validateOrganisationCollection,
  validateOrganisationStats,
  validateOwnedOrganisation,
  validateVolunteeringSearch,
} = require('./member-response-contracts.cjs');

describe('live member response-contract validators', () => {
  it('accepts populated server-shaped responses', () => {
    expect(() => validateListingSearch({ data: [{ id: 1, title: 'x', description: 'x', type: 'offer', status: 'active', hours_estimate: 1, created_at: 'now', is_favorited: false }], meta: {} })).not.toThrow();
    expect(() => validateMemberSearch({ data: [{ id: 2, name: 'B', first_name: 'B', tagline: null, location: null, created_at: 'now', rating: null, total_hours_given: 0, total_hours_received: 0 }], meta: {} })).not.toThrow();
    expect(() => validateConnectionStatus({ data: { status: 'none', connection_id: null, direction: null } })).not.toThrow();
    expect(() => validateCanonicalEvents({ data: [{ id: 3, title: 'Event', description: 'x', organizer: {}, location: {}, schedule: {}, relationship: {}, permissions: {}, metrics: {} }], meta: {} })).not.toThrow();
    expect(() => validateMarketplaceSearch({ data: [{ id: 4, title: 'Helmet', price: 12, price_currency: 'EUR', price_type: 'fixed', delivery_method: 'pickup', status: 'active', image: null, image_count: 0, is_saved: false, is_own: false, is_promoted: false, views_count: 0, created_at: 'now' }], meta: {} })).not.toThrow();
    expect(() => validateVolunteeringSearch({ data: [{ id: 5, title: 'Garden', description: 'x', organization: {}, location: 'Hall', is_remote: false, skills_needed: [], status: 'open', created_at: 'now' }], meta: {} })).not.toThrow();
    expect(() => validateMatchesPayload({ data: { matches: [], meta: { needs_location: true, degraded: true, degraded_reason: 'no_coordinates', has_active_listings: true, paused: false } } })).not.toThrow();
    expect(() => validateOwnedOrganisation({ data: [{ id: 6, name: 'Garden' }], meta: { has_more: false, cursor: null } })).not.toThrow();
    expect(() => validateOrganisationStats({ data: { total_volunteers: 0, pending_applications: 0, pending_hours: 0, total_approved_hours: 0, active_opportunities: 1, wallet_balance: 0, auto_pay_enabled: false, org_name: 'Garden' } })).not.toThrow();
    expect(() => validateOrganisationCollection({ data: { items: [], cursor: null, has_more: false } }, 'owner collection')).not.toThrow();
  });

  it('fails closed on empty fixtures or missing client-consumed fields', () => {
    expect(() => validateListingSearch({ data: [], meta: {} })).toThrow(/fixture item/);
    expect(() => validateMemberSearch({ data: [{ id: 2 }], meta: {} })).toThrow(/missing/);
    expect(() => validateConnectionStatus({ data: { status: 'none' } })).toThrow(/missing/);
    expect(() => validateCanonicalEvents({ data: [{ id: 3 }], meta: {} })).toThrow(/missing/);
    expect(() => validateMarketplaceSearch({ data: [], meta: {} })).toThrow(/fixture item/);
    expect(() => validateVolunteeringSearch({ data: [], meta: {} })).toThrow(/fixture item/);
    expect(() => validateMatchesPayload({ data: { matches: [], meta: { degraded: false } } })).toThrow(/missing/);
    expect(() => validateOwnedOrganisation({ data: [], meta: {} })).toThrow(/fixture item/);
    expect(() => validateOrganisationStats({ data: { total_volunteers: 0 } })).toThrow(/missing/);
    expect(() => validateOrganisationCollection({ data: {} }, 'owner collection')).toThrow(/missing/);
  });
});
