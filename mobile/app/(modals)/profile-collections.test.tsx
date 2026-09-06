// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockCreateSavedCollection = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    error: '#ef4444',
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
// Stable references so screens that put `show` in a useCallback/useEffect
// dependency array don't re-run their effects on every render.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/Toggle', () => {
  const { Text } = require('react-native');
  return function MockToggle({ label }: { label?: string }) {
    return label ? <Text>{label}</Text> : null;
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'collections.myTitle': 'My collections',
        'collections.mySubtitle': 'Organise saved items into reusable collections.',
        'collections.publicTitle': 'Public collections',
        'collections.publicSubtitle': 'Browse collections this member has shared publicly.',
        'collections.create': 'Create collection',
        'collections.closeCreate': 'Close create form',
        'collections.createTitle': 'Create collection',
        'collections.name': 'Name',
        'collections.namePlaceholder': 'Weekend projects',
        'collections.description': 'Description',
        'collections.descriptionPlaceholder': 'Optional note',
        'collections.makePublic': 'Make public',
        'collections.public': 'Public',
        'collections.private': 'Private',
        'collections.itemsCount': `${String(opts?.count ?? 0)} items`,
        'collections.emptyMineTitle': 'No collections yet',
        'collections.emptyMineSubtitle': 'Create a collection to organise saved items.',
        'collections.errorTitle': 'Could not load collections',
        'collections.nameRequired': 'Add a collection name.',
        'collections.createFailed': 'Could not create that collection.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/savedCollections', () => ({
  getMySavedCollections: jest.fn(),
  getPublicSavedCollections: jest.fn(),
  getSavedCollectionItems: jest.fn(),
  removeSavedItem: jest.fn(),
  createSavedCollection: (...args: unknown[]) => mockCreateSavedCollection(...args),
}));

import ProfileCollectionsScreen from './profile-collections';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSavedCollection.mockResolvedValue({ data: { id: 2, name: 'New set' } });
  mockUseApi.mockImplementation((_fetchFn: unknown, _deps: unknown[], options?: { enabled?: boolean }) => {
    if (options?.enabled === false) {
      return { data: null, isLoading: false, error: null, refresh: jest.fn() };
    }
    return {
      data: {
        data: [
          {
            id: 1,
            name: 'Weekend projects',
            description: 'Things to revisit later',
            color: '#6366f1',
            items_count: 2,
            is_public: true,
          },
        ],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
  });
});

describe('ProfileCollectionsScreen', () => {
  it('renders saved collection cards and opens the create form', async () => {
    const { findByText, getAllByText, getByPlaceholderText, getByTestId } = render(<ProfileCollectionsScreen />);

    expect(await findByText('Weekend projects')).toBeTruthy();

    fireEvent.press(getAllByText('Create collection')[0]);

    expect(getByPlaceholderText('Weekend projects')).toBeTruthy();
    expect(getByPlaceholderText('Optional note')).toBeTruthy();
    expect(getByTestId('saved-collection-name')).toBeTruthy();
    expect(getByTestId('saved-collection-description')).toBeTruthy();
    expect(getByTestId('create-saved-collection-submit')).toBeTruthy();
  });

  it('submits new collections through the API helper', async () => {
    const { getAllByText, getByPlaceholderText } = render(<ProfileCollectionsScreen />);

    fireEvent.press(getAllByText('Create collection')[0]);
    fireEvent.changeText(getByPlaceholderText('Weekend projects'), 'Training links');
    fireEvent.changeText(getByPlaceholderText('Optional note'), 'Things to read later');
    fireEvent.press(getAllByText('Create collection').at(-1)!);

    await waitFor(() => {
      expect(mockCreateSavedCollection).toHaveBeenCalledWith({
        name: 'Training links',
        description: 'Things to read later',
        is_public: false,
      });
    });
  });
});
