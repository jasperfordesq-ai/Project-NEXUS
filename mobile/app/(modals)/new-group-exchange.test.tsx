// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateGroupExchange = jest.fn();
const mockGetMembers = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'groupExchanges.create.title': 'Create group exchange',
        'groupExchanges.create.eyebrow': 'Shared workflow',
        'groupExchanges.create.subtitle': 'Start a multi-person time exchange.',
        'groupExchanges.create.fields.title': 'Title',
        'groupExchanges.create.fields.description': 'Description',
        'groupExchanges.create.fields.totalHours': 'Total hours',
        'groupExchanges.create.fields.splitType': 'Split type',
        'groupExchanges.create.fields.memberSearch': 'Find members',
        'groupExchanges.create.fields.participantHours': 'Hours',
        'groupExchanges.create.fields.participantWeight': 'Weight',
        'groupExchanges.create.placeholders.title': 'e.g. Community garden workday',
        'groupExchanges.create.placeholders.description': 'Describe the shared work.',
        'groupExchanges.create.placeholders.totalHours': 'e.g. 6',
        'groupExchanges.create.placeholders.memberSearch': 'Search by name or skill',
        'groupExchanges.create.placeholders.participantHours': '0',
        'groupExchanges.create.placeholders.participantWeight': '1',
        'groupExchanges.create.participantNote': 'Participant assignment continues from the detail workflow.',
        'groupExchanges.create.participantsTitle': 'Participants',
        'groupExchanges.create.participantsDescription': 'Optionally add members before creating.',
        'groupExchanges.create.searchMembers': 'Search members',
        'groupExchanges.create.searching': 'Searching...',
        'groupExchanges.create.searchError': 'Could not search members.',
        'groupExchanges.create.addProvider': 'Add provider',
        'groupExchanges.create.addReceiver': 'Add receiver',
        'groupExchanges.create.providers': `${String(opts?.count ?? 0)} providers`,
        'groupExchanges.create.receivers': `${String(opts?.count ?? 0)} receivers`,
        'groupExchanges.create.summaryHours': `${String(opts?.count ?? 0)} hours planned`,
        'groupExchanges.create.summaryParticipants': `${String(opts?.count ?? 0)} participants selected`,
        'groupExchanges.create.remove': 'Remove',
        'groupExchanges.create.removeParticipant': `Remove ${String(opts?.name ?? '')}`,
        'groupExchanges.create.submit': 'Create exchange',
        'groupExchanges.create.saving': 'Creating...',
        'groupExchanges.create.error': 'Could not create group exchange.',
        'groupExchanges.detail.roles.provider': 'Provider',
        'groupExchanges.detail.roles.receiver': 'Receiver',
        'groupExchanges.split.equal': 'Equal split',
        'groupExchanges.split.custom': 'Custom split',
        'groupExchanges.split.weighted': 'Weighted split',
        'common:buttons.back': 'Back',
        'common:errors.alertTitle': 'Something went wrong',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
// Confirmations resolve immediately so the guarded action runs in the test.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000',
    textSecondary: '#666',
  }),
}));
jest.mock('@/lib/api/groupExchanges', () => ({
  createGroupExchange: (...args: unknown[]) => mockCreateGroupExchange(...args),
}));
jest.mock('@/lib/api/members', () => ({
  getMembers: (...args: unknown[]) => mockGetMembers(...args),
}));

// Stable AppToast mock — fns created inside the factory closure.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import NewGroupExchangeRoute from './new-group-exchange';

beforeEach(() => {
  mockCreateGroupExchange.mockReset().mockResolvedValue({ data: { id: 55 } });
  mockGetMembers.mockReset().mockResolvedValue({
    data: [
      {
        id: 7,
        name: 'Alice Provider',
        first_name: 'Alice',
        last_name: 'Provider',
        avatar: null,
        avatar_url: null,
        tagline: null,
        location: 'Northside',
        latitude: null,
        longitude: null,
        created_at: '2026-01-01T00:00:00Z',
        is_verified: true,
        rating: null,
        total_hours_given: 0,
        total_hours_received: 0,
      },
      {
        id: 8,
        name: 'Riley Receiver',
        first_name: 'Riley',
        last_name: 'Receiver',
        avatar: null,
        avatar_url: null,
        tagline: null,
        location: 'Southside',
        latitude: null,
        longitude: null,
        created_at: '2026-01-01T00:00:00Z',
        is_verified: false,
        rating: null,
        total_hours_given: 0,
        total_hours_received: 0,
      },
    ],
  });
  mockRouterReplace.mockReset();
});

describe('NewGroupExchangeRoute', () => {
  it('creates a draft group exchange and opens its detail route', async () => {
    const { getAllByPlaceholderText, getAllByText, getByPlaceholderText, getByText } = render(<NewGroupExchangeRoute />);

    fireEvent.changeText(getByPlaceholderText('e.g. Community garden workday'), 'Community garden workday');
    fireEvent.changeText(getByPlaceholderText('Describe the shared work.'), 'Prepare the beds and paths together.');
    fireEvent.changeText(getByPlaceholderText('e.g. 6'), '6');
    fireEvent.press(getByText('Weighted split'));
    fireEvent.changeText(getByPlaceholderText('Search by name or skill'), 'garden');
    fireEvent.press(getByText('Search members'));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith(0, 'garden'));
    fireEvent.press(getAllByText('Add provider')[0]);
    fireEvent.press(getAllByText('Add receiver')[0]);
    fireEvent.changeText(getAllByPlaceholderText('0')[0], '2');
    fireEvent.changeText(getAllByPlaceholderText('1')[0], '1.5');
    fireEvent.changeText(getAllByPlaceholderText('0')[1], '4');
    fireEvent.changeText(getAllByPlaceholderText('1')[1], '2');
    fireEvent.press(getByText('Create exchange'));

    await waitFor(() => {
      expect(mockCreateGroupExchange).toHaveBeenCalledWith({
        title: 'Community garden workday',
        description: 'Prepare the beds and paths together.',
        split_type: 'weighted',
        total_hours: 6,
        participants: [
          { user_id: 7, role: 'provider', hours: 2, weight: 1.5 },
          { user_id: 8, role: 'receiver', hours: 4, weight: 2 },
        ],
      });
    });
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/group-exchange-detail',
      params: { id: '55' },
    });
  });
});
