// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockFeatures: Record<string, boolean> = { ideation_challenges: true };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'ideation:campaigns.title': 'Campaigns',
      'ideation:campaigns.empty_title': 'No campaigns yet.',
      'ideation:campaigns.empty_description': 'Campaigns group challenges together.',
      'ideation:campaigns.feature_not_available': 'Ideation is not enabled for your community.',
      'ideation:campaigns.feature_not_available_desc': 'Ask a coordinator to turn it on.',
      'ideation:campaigns.challenges_count': `${String(values?.count ?? 0)} challenges`,
      'ideation:campaigns.retry': 'Retry',
      'ideation:challenges.load_error': 'Campaigns could not be loaded.',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (name: string) => Boolean(mockFeatures[name]) }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/ideation', () => ({ getIdeationCampaigns: jest.fn() }));

import IdeationCampaignsScreen from './ideation-campaigns';
import { getIdeationCampaigns } from '@/lib/api/ideation';
import { ApiResponseError } from '@/lib/api/client';

describe('IdeationCampaignsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatures = { ideation_challenges: true };
    jest.mocked(getIdeationCampaigns).mockResolvedValue({
      items: [
        { id: 5, title: 'Greener streets', description: 'Ideas for the high street.', challenges_count: 3, status: 'open' },
      ],
      nextCursor: null,
      hasMore: false,
    } as never);
  });

  it('lists campaigns and opens one', async () => {
    const { getByText } = render(<IdeationCampaignsScreen />);
    await waitFor(() => expect(getByText('Greener streets')).toBeTruthy());
    expect(getByText('3 challenges')).toBeTruthy();
    expect(getByText('open')).toBeTruthy();

    fireEvent.press(getByText('Greener streets'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-campaign-detail', params: { id: '5' } });
  });

  it('says so when there are no campaigns', async () => {
    jest.mocked(getIdeationCampaigns).mockResolvedValue({ items: [], nextCursor: null, hasMore: false } as never);
    const { getByText } = render(<IdeationCampaignsScreen />);
    await waitFor(() => expect(getByText('No campaigns yet.')).toBeTruthy());
  });

  it('says so, and calls nothing, when the community has no ideation module', async () => {
    mockFeatures = { ideation_challenges: false };
    const { getByText } = render(<IdeationCampaignsScreen />);
    await waitFor(() => expect(getByText('Ideation is not enabled for your community.')).toBeTruthy());
    expect(getIdeationCampaigns).not.toHaveBeenCalled();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    jest.mocked(getIdeationCampaigns).mockRejectedValue(new ApiResponseError(403, 'Campaigns unavailable'));
    const { getByText } = render(<IdeationCampaignsScreen />);
    await waitFor(() => expect(getByText('Campaigns could not be loaded.')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getIdeationCampaigns).toHaveBeenCalledTimes(2));
  });
});
