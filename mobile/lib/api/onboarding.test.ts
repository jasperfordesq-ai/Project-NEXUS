// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import {
  completeOnboarding,
  getOnboardingCategories,
  getOnboardingConfig,
  getOnboardingStatus,
  getSafeguardingOptions,
  saveSafeguardingPreferences,
} from './onboarding';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('onboarding API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unwraps status, configuration, categories and safeguarding options', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { onboarding_completed: false, has_avatar: true, has_bio: true, interests: [] } })
      .mockResolvedValueOnce({ data: { config: { bio_min_length: 10 }, steps: [{ slug: 'profile', required: true }] } })
      .mockResolvedValueOnce({ data: [{ id: 4, name: 'Gardening', slug: 'gardening', color: '#080' }] })
      .mockResolvedValueOnce({ data: [{ id: 9, option_key: 'none_apply', option_type: 'checkbox', label: 'None apply', is_required: false }] });

    await expect(getOnboardingStatus()).resolves.toMatchObject({ onboarding_completed: false, has_avatar: true });
    await expect(getOnboardingConfig()).resolves.toMatchObject({ steps: [{ slug: 'profile', required: true }] });
    await expect(getOnboardingCategories()).resolves.toEqual([expect.objectContaining({ id: 4 })]);
    await expect(getSafeguardingOptions()).resolves.toEqual([expect.objectContaining({ id: 9 })]);

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/onboarding/status');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/onboarding/config');
    expect(api.get).toHaveBeenNthCalledWith(3, '/api/v2/onboarding/categories');
    expect(api.get).toHaveBeenNthCalledWith(4, '/api/v2/onboarding/safeguarding-options');
  });

  it('saves explicit safeguarding preferences and completes atomically', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { message: 'Saved', preferences_count: 1 } })
      .mockResolvedValueOnce({ data: { message: 'Complete', listings_created: 2, listing_ids: [12, 13] } });

    await expect(saveSafeguardingPreferences([{ option_id: 9, value: '1' }])).resolves.toMatchObject({ preferences_count: 1 });
    await expect(completeOnboarding({ interests: [1], offers: [2], needs: [3] })).resolves.toMatchObject({ listings_created: 2 });

    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/onboarding/safeguarding', {
      preferences: [{ option_id: 9, value: '1' }],
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/onboarding/complete', {
      interests: [1], offers: [2], needs: [3],
    });
  });
});
