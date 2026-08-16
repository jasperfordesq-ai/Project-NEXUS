// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pickup-slot start/end were converted from native datetime-local inputs to the GOV.UK
 * date + single-time pattern. The form now posts four fields per datetime
 * (`slot_start-day/-month/-year/-time`); the payload builder must recombine them into the
 * exact `YYYY-MM-DDTHH:MM` the Laravel API already expected, so nothing downstream changes.
 */
const { pickupSlotPayload } = require('../src/routes/marketplace-actions');

describe('pickup-slot datetime recombination', () => {
  it('recombines the four GOV.UK fields into the native YYYY-MM-DDTHH:MM shape', () => {
    const payload = pickupSlotPayload({
      'slot_start-day': '14', 'slot_start-month': '8', 'slot_start-year': '2026', 'slot_start-time': '9:30am',
      'slot_end-day': '14', 'slot_end-month': '8', 'slot_end-year': '2026', 'slot_end-time': '17:00',
      capacity: '5'
    });
    expect(payload.slot_start).toBe('2026-08-14T09:30');
    expect(payload.slot_end).toBe('2026-08-14T17:00');
  });

  it('still accepts an already-composed value (old client / direct API-shape post)', () => {
    const payload = pickupSlotPayload({ slot_start: '2026-08-14T09:30', slot_end: '2026-08-14T17:00' });
    expect(payload.slot_start).toBe('2026-08-14T09:30');
    expect(payload.slot_end).toBe('2026-08-14T17:00');
  });

  it('yields an empty string (not a partial/garbage value) when a datetime is incomplete', () => {
    // Matches the previous trimmed()-based behaviour: absent/invalid → '' so the API validates.
    const payload = pickupSlotPayload({ 'slot_start-day': '14', 'slot_start-month': '8', 'slot_start-year': '2026', 'slot_start-time': '' });
    expect(payload.slot_start).toBe('');
  });
});
