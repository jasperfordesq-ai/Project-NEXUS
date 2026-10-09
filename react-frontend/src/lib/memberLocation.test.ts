// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  hasLocationText,
  isLocationMissing,
  locationErrorField,
  locationUpdatePayload,
} from './memberLocation';

describe('isLocationMissing', () => {
  it('is true only when the server said so', () => {
    expect(isLocationMissing({ location_missing: true })).toBe(true);
    expect(isLocationMissing({ location_missing: false })).toBe(false);
  });

  it('treats an absent flag, or no user, as not missing', () => {
    expect(isLocationMissing({})).toBe(false);
    expect(isLocationMissing(null)).toBe(false);
    expect(isLocationMissing(undefined)).toBe(false);
  });
});

describe('hasLocationText', () => {
  it('ignores whitespace', () => {
    expect(hasLocationText({ location: '' })).toBe(false);
    expect(hasLocationText({ location: '   ' })).toBe(false);
    expect(hasLocationText({ location: ' Cork ' })).toBe(true);
  });
});

describe('locationUpdatePayload', () => {
  it('trims the text and leaves coordinates out when none were picked', () => {
    expect(locationUpdatePayload({ location: '  Cork ' })).toEqual({ location: 'Cork' });
  });

  it('sends coordinates only when both are known', () => {
    expect(locationUpdatePayload({ location: 'Cork', latitude: 51.9, longitude: -8.47 })).toEqual({
      location: 'Cork',
      latitude: 51.9,
      longitude: -8.47,
    });
    expect(locationUpdatePayload({ location: 'Cork', latitude: 51.9 })).toEqual({ location: 'Cork' });
  });

  it('keeps a genuine zero coordinate', () => {
    expect(locationUpdatePayload({ location: 'Greenwich', latitude: 51.48, longitude: 0 })).toEqual({
      location: 'Greenwich',
      latitude: 51.48,
      longitude: 0,
    });
  });
});

describe('locationErrorField', () => {
  it('names the refused field', () => {
    expect(locationErrorField([{ field: 'location' }])).toBe('location');
    expect(locationErrorField([{ field: 'latitude' }])).toBe('coordinates');
    expect(locationErrorField([{ field: 'longitude' }])).toBe('coordinates');
  });

  it('returns null for other or missing detail', () => {
    expect(locationErrorField([{ field: 'bio' }])).toBeNull();
    expect(locationErrorField([])).toBeNull();
    expect(locationErrorField(undefined)).toBeNull();
  });
});
