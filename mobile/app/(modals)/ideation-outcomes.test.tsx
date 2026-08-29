// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockFeatures: Record<string, boolean> = { ideation_challenges: true };

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'ideation:outcomes.dashboard': 'What happened next',
      'ideation:outcomes.total_challenges': 'Challenges',
      'ideation:outcomes.implemented_count': 'Implemented',
      'ideation:outcomes.in_progress_count': 'In progress',
      'ideation:outcomes.status_not_started': 'Not started',
      'ideation:outcomes.status_implemented': 'Implemented',
      'ideation:outcomes.empty_title': 'No outcomes recorded yet.',
      'ideation:outcomes.winning_idea': 'Winning idea',
      'ideation:challenges.load_error': 'Outcomes could not be loaded.',
      'ideation:actions.retry': 'Retry',
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
jest.mock('@/lib/api/ideation', () => ({ getIdeationOutcomes: jest.fn() }));

import IdeationOutcomesScreen from './ideation-outcomes';
import { getIdeationOutcomes } from '@/lib/api/ideation';
import { ApiResponseError } from '@/lib/api/client';

describe('IdeationOutcomesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatures = { ideation_challenges: true };
    jest.mocked(getIdeationOutcomes).mockResolvedValue({
      total: 9,
      implemented: 4,
      in_progress: 3,
      not_started: 2,
      abandoned: 0,
      outcomes: [
        {
          challenge_id: 21,
          challenge_title: 'Plant more trees',
          winning_idea_title: 'Orchard on the green',
          implementation_status: 'implemented',
          impact_description: 'Twelve trees planted.',
          updated_at: '2026-08-01T00:00:00Z',
        },
      ],
    } as never);
  });

  it('shows the headline counts and each recorded outcome', async () => {
    const { getByText } = render(<IdeationOutcomesScreen />);
    await waitFor(() => expect(getByText('Plant more trees')).toBeTruthy());
    expect(getByText('9')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('Winning idea: Orchard on the green')).toBeTruthy();
    expect(getByText('Twelve trees planted.')).toBeTruthy();
  });

  it('opens the challenge behind an outcome', async () => {
    const { getByText } = render(<IdeationOutcomesScreen />);
    await waitFor(() => expect(getByText('Plant more trees')).toBeTruthy());
    fireEvent.press(getByText('Plant more trees'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '21' } });
  });

  it('says so when nothing has been recorded yet', async () => {
    jest.mocked(getIdeationOutcomes).mockResolvedValue({
      total: 0, implemented: 0, in_progress: 0, not_started: 0, abandoned: 0, outcomes: [],
    } as never);
    const { getByText } = render(<IdeationOutcomesScreen />);
    await waitFor(() => expect(getByText('No outcomes recorded yet.')).toBeTruthy());
  });

  it('says so, and calls nothing, when the community has no ideation module', async () => {
    mockFeatures = { ideation_challenges: false };
    const { getByText } = render(<IdeationOutcomesScreen />);
    await waitFor(() => expect(getByText('Outcomes could not be loaded.')).toBeTruthy());
    expect(getIdeationOutcomes).not.toHaveBeenCalled();
  });

  it('offers a retry when the dashboard cannot be loaded', async () => {
    jest.mocked(getIdeationOutcomes).mockRejectedValue(new ApiResponseError(403, 'Outcomes unavailable'));
    const { getByText } = render(<IdeationOutcomesScreen />);
    await waitFor(() => expect(getByText('Outcomes unavailable')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getIdeationOutcomes).toHaveBeenCalledTimes(2));
  });
});
