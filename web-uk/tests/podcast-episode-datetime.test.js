// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Episode `scheduled_for` was converted from a native datetime-local input to the GOV.UK
 * date + single-time pattern. The payload builder must recombine the four posted fields
 * into the same YYYY-MM-DDTHH:MM the Laravel API already expected, and keep the existing
 * "absent on create → omitted, absent on update → null" behaviour.
 */
const { episodePayload } = require('../src/routes/podcast-actions');

describe('podcast episode scheduled_for recombination', () => {
  it('recombines the four GOV.UK fields into YYYY-MM-DDTHH:MM', () => {
    const { payload } = episodePayload({
      'scheduled_for-day': '7', 'scheduled_for-month': '9', 'scheduled_for-year': '2026', 'scheduled_for-time': '8:05pm'
    });
    expect(payload.scheduled_for).toBe('2026-09-07T20:05');
  });

  it('still accepts an already-composed single value', () => {
    expect(episodePayload({ scheduled_for: '2026-09-07T20:05' }).payload.scheduled_for).toBe('2026-09-07T20:05');
  });

  it('omits scheduled_for on create when empty, and nulls it on update', () => {
    expect('scheduled_for' in episodePayload({}).payload).toBe(false);
    expect(episodePayload({}, { update: true }).payload.scheduled_for).toBeNull();
  });
});
