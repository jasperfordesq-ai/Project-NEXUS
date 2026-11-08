// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { aiDescriptionAvailable } from './aiDescriptions';

describe('aiDescriptionAvailable', () => {
  it('is true only when the server says exactly true for that area', () => {
    const tenant = { ai_descriptions: { listings: true, jobs: false, marketplace: true } };

    expect(aiDescriptionAvailable(tenant, 'listings')).toBe(true);
    expect(aiDescriptionAvailable(tenant, 'jobs')).toBe(false);
    expect(aiDescriptionAvailable(tenant, 'marketplace')).toBe(true);
  });

  it('is false when the tenant is not loaded yet', () => {
    expect(aiDescriptionAvailable(null, 'listings')).toBe(false);
    expect(aiDescriptionAvailable(undefined, 'jobs')).toBe(false);
  });

  it('is false when the server does not send the field (an older server)', () => {
    expect(aiDescriptionAvailable({}, 'listings')).toBe(false);
    expect(aiDescriptionAvailable({ ai_descriptions: {} }, 'marketplace')).toBe(false);
  });

  it('does not treat a truthy non-boolean as permission', () => {
    const tenant = { ai_descriptions: { listings: 'yes' as unknown as boolean } };

    expect(aiDescriptionAvailable(tenant, 'listings')).toBe(false);
  });
});
