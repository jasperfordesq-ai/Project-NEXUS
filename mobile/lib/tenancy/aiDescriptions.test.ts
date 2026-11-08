// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { aiDescriptionAvailable } from './aiDescriptions';

describe('aiDescriptionAvailable', () => {
  it('is available only when the server flag for that surface is exactly true', () => {
    const tenant = { ai_descriptions: { listings: true, jobs: false, marketplace: true } };
    expect(aiDescriptionAvailable(tenant, 'listings')).toBe(true);
    expect(aiDescriptionAvailable(tenant, 'jobs')).toBe(false);
    expect(aiDescriptionAvailable(tenant, 'marketplace')).toBe(true);
  });

  it('is hidden when the community is not loaded yet', () => {
    expect(aiDescriptionAvailable(null, 'listings')).toBe(false);
    expect(aiDescriptionAvailable(undefined, 'jobs')).toBe(false);
  });

  it('is hidden when an older server sends no ai_descriptions object', () => {
    expect(aiDescriptionAvailable({}, 'listings')).toBe(false);
    expect(aiDescriptionAvailable({ ai_descriptions: undefined }, 'marketplace')).toBe(false);
  });

  it('is hidden when the surface key is missing', () => {
    expect(aiDescriptionAvailable({ ai_descriptions: { listings: true } }, 'jobs')).toBe(false);
  });

  it('does not treat truthy non-boolean values as permission', () => {
    // A malformed payload must not switch the button on.
    const malformed = { ai_descriptions: { listings: 1, jobs: 'true', marketplace: {} } } as unknown as Parameters<typeof aiDescriptionAvailable>[0];
    expect(aiDescriptionAvailable(malformed, 'listings')).toBe(false);
    expect(aiDescriptionAvailable(malformed, 'jobs')).toBe(false);
    expect(aiDescriptionAvailable(malformed, 'marketplace')).toBe(false);
  });
});
