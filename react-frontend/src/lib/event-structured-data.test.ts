// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { buildEventStructuredData } from './event-structured-data';
import type { PublicEventDetail } from './public-events-api';

const EVENT: PublicEventDetail = {
  id: 12,
  title: 'Wassail in the Orchard',
  description: 'A midwinter community celebration.',
  start_time: '2026-12-14T18:00:00Z',
  end_time: null,
  timezone: 'Europe/London',
  all_day: false,
  location: 'Coventry Community Orchard',
  latitude: null,
  longitude: null,
  is_online: false,
  attendance_mode: 'in_person',
  operational_status: 'scheduled',
  image_url: null,
  category: null,
  organizer_name: null,
  accessibility: null,
};

const CONTEXT = {
  pageUrl: 'https://example.test/whats-on/12',
  organizer: { name: 'Test Community', url: 'https://example.test' },
};

describe('buildEventStructuredData', () => {
  it('describes an in-person event at its venue', () => {
    const data = buildEventStructuredData(EVENT, CONTEXT);
    expect(data?.location).toMatchObject({ '@type': 'Place', name: 'Coventry Community Orchard' });
  });

  // Google requires a location; an in-person event without a venue has none.
  it.each([null, '', '   '])('gives no block for an in-person event with venue %j', (location) => {
    expect(buildEventStructuredData({ ...EVENT, location }, CONTEXT)).toBeNull();
  });

  it('still describes an online event with no venue, at the event page', () => {
    const data = buildEventStructuredData({ ...EVENT, location: null, attendance_mode: 'online', is_online: true }, CONTEXT);
    expect(data?.location).toEqual({ '@type': 'VirtualLocation', url: CONTEXT.pageUrl });
  });

  it('still describes a hybrid event with no venue, at the event page', () => {
    const data = buildEventStructuredData({ ...EVENT, location: null, attendance_mode: 'hybrid', is_online: true }, CONTEXT);
    expect(data?.location).toEqual({ '@type': 'VirtualLocation', url: CONTEXT.pageUrl });
  });
});
