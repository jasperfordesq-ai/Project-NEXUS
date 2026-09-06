// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
let mockFeatures: Record<string, boolean> = { ideation_challenges: true };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'ideation:campaigns.fallback_title': 'Campaign',
      'ideation:campaigns.challenges_count': `${String(values?.count ?? 0)} challenges`,
      'ideation:challenges.load_error': 'The campaign could not be loaded.',
      'ideation:challenges.empty_title': 'No challenges in this campaign yet.',
      'ideation:actions.retry': 'Retry',
      'ideation:status.open': 'Open',
      'ideation:ideasCount': `${String(values?.count ?? 0)} ideas`,
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
jest.mock('@/lib/api/ideation', () => ({ getIdeationCampaign: jest.fn() }));

import IdeationCampaignDetailScreen from './ideation-campaign-detail';
import { getIdeationCampaign } from '@/lib/api/ideation';
import { ApiResponseError } from '@/lib/api/client';

describe('IdeationCampaignDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '5' };
    mockFeatures = { ideation_challenges: true };
    jest.mocked(getIdeationCampaign).mockResolvedValue({
      id: 5,
      title: 'Greener streets',
      description: 'Ideas for the high street.',
      challenges_count: 1,
      challenges: [
        { id: 21, title: 'Plant more trees', description: 'Where should they go?', status: 'open', ideas_count: 4 },
      ],
    } as never);
  });

  it('renders the campaign and opens one of its challenges', async () => {
    const { getByText } = render(<IdeationCampaignDetailScreen />);
    await waitFor(() => expect(getByText('Greener streets')).toBeTruthy());
    expect(getIdeationCampaign).toHaveBeenCalledWith(5);
    expect(getByText('Ideas for the high street.')).toBeTruthy();
    expect(getByText('Plant more trees')).toBeTruthy();
    expect(getByText('4 ideas')).toBeTruthy();

    fireEvent.press(getByText('Plant more trees'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '21' } });
  });

  it('says so when the campaign has no challenges', async () => {
    jest.mocked(getIdeationCampaign).mockResolvedValue({
      id: 5, title: 'Greener streets', description: null, challenges_count: 0, challenges: [],
    } as never);
    const { getByText } = render(<IdeationCampaignDetailScreen />);
    await waitFor(() => expect(getByText('No challenges in this campaign yet.')).toBeTruthy());
  });

  it('does not call the API without a campaign id', async () => {
    mockParams = {};
    const { getByText } = render(<IdeationCampaignDetailScreen />);
    await waitFor(() => expect(getByText('The campaign could not be loaded.')).toBeTruthy());
    expect(getIdeationCampaign).not.toHaveBeenCalled();
  });

  it('offers a retry when the campaign cannot be loaded', async () => {
    jest.mocked(getIdeationCampaign).mockRejectedValue(new ApiResponseError(404, 'Campaign not found'));
    const { getByText } = render(<IdeationCampaignDetailScreen />);
    await waitFor(() => expect(getByText('Campaign not found')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getIdeationCampaign).toHaveBeenCalledTimes(2));
  });
});
