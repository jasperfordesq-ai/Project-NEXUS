// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      title: 'Clubs',
      subtitle: 'Community clubs you can join',
      search_placeholder: 'Search clubs…',
      view: 'Visit website',
      'empty.title': 'No clubs yet.',
      'empty.body': 'Check back soon.',
      member_count: `${String(values?.count ?? 0)} members`,
      meeting_schedule: `Meets ${String(values?.schedule ?? '')}`,
      'common:buttons.retry': 'Retry',
      'common:actions.clear': 'Clear',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777', border: '#ddd' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/clubs', () => ({ getClubs: jest.fn() }));

import ClubsScreen from './clubs';
import { getClubs } from '@/lib/api/clubs';
import { ApiResponseError } from '@/lib/api/client';

const page = (items: unknown[]) => ({ items, page: 1, total: items.length, hasMore: false });

describe('ClubsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    jest.mocked(getClubs).mockResolvedValue(page([
      {
        id: 3,
        name: 'Repair Café',
        description: 'Fix things together.',
        meeting_schedule: 'first Saturday',
        member_count: 24,
        website: 'https://example.org/repair',
      },
      { id: 4, name: 'Walking Group', member_count: 8 },
    ]) as never);
  });

  it('lists the clubs with their membership and meeting detail', async () => {
    const { getByText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByText('Repair Café')).toBeTruthy());
    expect(getByText('24 members')).toBeTruthy();
    expect(getByText('Meets first Saturday')).toBeTruthy();
    expect(getByText('Walking Group')).toBeTruthy();
  });

  it('opens the club website when the card is pressed', async () => {
    const { getByLabelText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByLabelText('Visit website: Repair Café')).toBeTruthy());
    fireEvent.press(getByLabelText('Visit website: Repair Café'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.org/repair');
  });

  it('searches on submit and clears the query when the field is emptied', async () => {
    const { getByPlaceholderText } = render(<ClubsScreen />);
    await waitFor(() => expect(getClubs).toHaveBeenCalledTimes(1));
    const field = getByPlaceholderText('Search clubs…');
    fireEvent.changeText(field, 'repair');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(getClubs).toHaveBeenCalledWith({ search: 'repair' }));
    fireEvent.changeText(field, '');
    await waitFor(() => expect(getClubs).toHaveBeenLastCalledWith({ search: undefined }));
  });

  it('offers a retry when the list cannot be loaded', async () => {
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(500, 'Clubs unavailable'));
    const { getByText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByText('Clubs unavailable')).toBeTruthy(), { timeout: 5000 });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(jest.mocked(getClubs).mock.calls.length).toBeGreaterThan(1));
  });
});
