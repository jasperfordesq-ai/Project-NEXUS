// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockSubmitIdea = jest.fn();
const mockVoteIdea = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: '12' }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7, role: 'member' } }),
}));

jest.mock('@/lib/api/ideation', () => ({
  getIdeationChallenge: jest.fn(),
  getIdeationIdeas: jest.fn(),
  submitIdeationIdea: (...args: unknown[]) => mockSubmitIdea(...args),
  voteIdeationIdea: (...args: unknown[]) => mockVoteIdea(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    info: '#2563eb',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'ideation:challengeTitle': 'Challenge',
        'ideation:status.open': 'Open',
        'ideation:ideasCount': opts ? `${String(opts.count)} ideas` : 'ideas',
        'ideation:votesCount': opts ? `${String(opts.count)} votes` : 'votes',
        'ideation:submitIdea': 'Submit idea',
        'ideation:ideaTitleLabel': 'Idea title',
        'ideation:ideaTitlePlaceholder': 'Name your idea',
        'ideation:ideaDescriptionLabel': 'Idea description',
        'ideation:ideaDescriptionPlaceholder': 'Describe what should happen and why it helps',
        'ideation:submitting': 'Submitting...',
        'ideation:submitSuccess': 'Idea submitted.',
        'ideation:vote': 'Vote',
        'ideation:voted': 'Voted',
        'ideation:ideaStatus.submitted': 'Submitted',
        'ideation:sort.votes': 'Top voted',
        'ideation:sort.newest': 'Newest',
      };
      return map[key] ?? key;
    },
  }),
}));

import IdeationDetailScreen from './ideation-detail';

describe('IdeationDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const refreshChallenge = jest.fn();
    const refreshIdeas = jest.fn();
    let call = 0;
    mockUseApi.mockImplementation(() => {
      call += 1;
      if (call % 2 === 1) {
        return {
          data: {
            id: 12,
            title: 'Improve the park',
            description: '<p>Collect ideas for safer paths.</p>',
            status: 'open',
            ideas_count: 1,
          },
          isLoading: false,
          error: null,
          refresh: refreshChallenge,
        };
      }
      return {
        data: {
          items: [
            {
              id: 44,
              title: 'Better lighting',
              description: 'Add lights near the west gate.',
              status: 'submitted',
              votes_count: 4,
              has_voted: false,
            },
          ],
        },
        isLoading: false,
        error: null,
        refresh: refreshIdeas,
      };
    });
    mockSubmitIdea.mockResolvedValue({ id: 99 });
    mockVoteIdea.mockResolvedValue({ voted: true, votes_count: 5 });
  });

  it('keeps the native ideation detail frame full height with an explicit background', () => {
    const { getByTestId } = render(<IdeationDetailScreen />);
    const screen = getByTestId('ideation-detail-screen');
    const scroll = getByTestId('ideation-detail-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 40,
    }));
  });

  it('renders challenge ideas, submits a new idea, and votes', async () => {
    const { getAllByText, getByPlaceholderText, getByText } = render(<IdeationDetailScreen />);

    expect(getAllByText('Improve the park').length).toBeGreaterThan(0);
    expect(getByText('Collect ideas for safer paths.')).toBeTruthy();
    expect(getByText('Better lighting')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Name your idea'), 'More benches');
    fireEvent.changeText(getByPlaceholderText('Describe what should happen and why it helps'), 'Add seating near the playground.');
    fireEvent.press(getAllByText('Submit idea')[1]);

    await waitFor(() => expect(mockSubmitIdea).toHaveBeenCalledWith(12, {
      title: 'More benches',
      description: 'Add seating near the playground.',
    }));

    fireEvent.press(getByText('Vote'));
    await waitFor(() => expect(mockVoteIdea).toHaveBeenCalledWith(44));
  });

  /**
   * 🔴 A refresh must not blank the page. Voting and submitting both call `refresh()`,
   * which flips `isLoading` back to true; the screen used that flag alone, so one tap on
   * Vote replaced the whole challenge with a spinner. Measured on a device 2026-08-22.
   */
  it('keeps the challenge on screen while a refresh is in flight', () => {
    mockUseApi.mockReset();
    let call = 0;
    mockUseApi.mockImplementation(() => {
      call += 1;
      if (call % 2 === 1) {
        return {
          data: { id: 12, title: 'Improve the park', description: 'Ideas please.', status: 'open', ideas_count: 1 },
          isLoading: true, // a refresh is running, but we already have the challenge
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: { items: [{ id: 44, title: 'Better lighting', description: 'Lights.', status: 'submitted', votes_count: 4, has_voted: false }] },
        isLoading: true,
        error: null,
        refresh: jest.fn(),
      };
    });

    const { getAllByText, getByText } = render(<IdeationDetailScreen />);

    expect(getAllByText('Improve the park').length).toBeGreaterThan(0);
    expect(getByText('Better lighting')).toBeTruthy();
  });

  it('still shows a spinner on the very first load, when there is nothing to show yet', () => {
    mockUseApi.mockReset();
    mockUseApi.mockImplementation(() => ({
      data: null,
      isLoading: true,
      error: null,
      refresh: jest.fn(),
    }));

    const { queryByText } = render(<IdeationDetailScreen />);

    expect(queryByText('Better lighting')).toBeNull();
  });
});
