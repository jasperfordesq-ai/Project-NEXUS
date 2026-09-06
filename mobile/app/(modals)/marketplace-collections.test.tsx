// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};
let mockEmptyStateAction: (() => void) | undefined;
const mockHasFeature = jest.fn(() => true);
let mockAuthState = { isAuthenticated: true, isLoading: false };
const mockT = (key: string, opts?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'common:back': 'Back',
    'common:buttons.cancel': 'Cancel',
    'common:buttons.retry': 'Retry',
    'common:errors.alertTitle': 'Error',
    'collections.title': 'Collections',
    'collections.eyebrow': 'Saved marketplace',
    'collections.subtitle': 'Review saved marketplace collections and run saved searches.',
    'collections.collectionsTab': 'Collections',
    'collections.savedTab': 'Saved searches',
    'collections.create': 'Create collection',
    'collections.createTitle': 'Create collection',
    'collections.createSubtitle': 'Group saved listings into a reusable set.',
    'collections.name': 'Name',
    'collections.namePlaceholder': 'Weekend projects',
    'collections.description': 'Description',
    'collections.descriptionPlaceholder': 'Optional note',
    'collections.manage': 'Manage in tools',
    'collections.signInTitle': 'Sign in to view saved marketplace',
    'collections.signInHint': 'Collections and saved searches are available after you sign in.',
    'collections.empty': 'No collections yet',
    'collections.emptyHint': 'Create collections from marketplace tools, then add listings as you browse.',
    'collections.count': `${String(opts?.count ?? 0)} listings`,
    'collections.public': 'Public',
    'collections.private': 'Private',
    'savedSearches.empty': 'No saved searches yet',
    'savedSearches.emptyHint': 'Save marketplace searches from tools to run them again quickly.',
    'savedSearches.anything': 'Any marketplace listing',
    'savedSearches.run': 'Run search',
    'tools.delete': 'Delete',
    'auth:login.submit': 'Sign in',
    'featureGate.title': 'Marketplace is not available',
    'featureGate.description': 'This community has not enabled marketplace listings.',
  };
  return map[key] ?? key;
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/LoadingSpinner', () => {
  const { Text } = require('react-native');
  return () => <Text>Loading</Text>;
});
jest.mock('@/components/ui/BottomSheet', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => {
    const { View } = require('react-native');
    return visible ? <View>{children}</View> : null;
  },
}));
jest.mock('@/components/marketplace/MarketplaceListingCard', () => {
  const { Text } = require('react-native');
  return () => <Text>Listing card</Text>;
});
jest.mock('@/components/ui/EmptyState', () => ({
  __esModule: true,
  default: (props: {
    title: string;
    subtitle?: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => {
    const { Pressable, Text, View } = require('react-native');
    mockEmptyStateAction = props.onAction;
    return (
      <View>
        <Text>{props.title}</Text>
        {props.subtitle ? <Text>{props.subtitle}</Text> : null}
        {props.actionLabel ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${props.actionLabel} empty state`} onPress={props.onAction}>
            <Text>{props.actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  },
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: mockHasFeature }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#dc2626',
  }),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: opening the dialog runs the destructive action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

jest.mock('@/lib/api/marketplace', () => ({
  createMarketplaceCollection: jest.fn(),
  deleteMarketplaceSavedSearch: jest.fn(),
  getMarketplaceCollectionItems: jest.fn(),
  getMarketplaceCollections: jest.fn(),
  getMarketplaceSavedSearches: jest.fn(),
  removeMarketplaceCollectionItem: jest.fn(),
}));

import MarketplaceCollectionsRoute from './marketplace-collections';
import { router } from 'expo-router';
import {
  getMarketplaceCollectionItems,
  getMarketplaceCollections,
  getMarketplaceSavedSearches,
} from '@/lib/api/marketplace';

describe('MarketplaceCollectionsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockEmptyStateAction = undefined;
    mockHasFeature.mockReturnValue(true);
    mockAuthState = { isAuthenticated: true, isLoading: false };
    jest.mocked(getMarketplaceCollections).mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Garden kit',
          description: 'Weekend projects',
          item_count: 2,
          is_public: false,
        },
      ],
    } as never);
    jest.mocked(getMarketplaceSavedSearches).mockResolvedValue({
      data: [
        {
          id: 2,
          name: 'Drills under 50',
          search_query: 'drill',
          filters: null,
          alert_frequency: 'daily',
        },
      ],
    } as never);
    jest.mocked(getMarketplaceCollectionItems).mockResolvedValue({ data: [] } as never);
  });

  it('opens the saved searches tab from the web-compatible searches route param', async () => {
    mockParams = { tab: 'searches' };

    const { findByText, queryByText } = render(<MarketplaceCollectionsRoute />);

    expect(await findByText('Drills under 50')).toBeTruthy();
    expect(queryByText('Garden kit')).toBeNull();
  });

  it('opens saved-search management from the saved-search empty state', async () => {
    mockParams = { tab: 'saved' };
    jest.mocked(getMarketplaceSavedSearches).mockResolvedValue({ data: [] } as never);

    const { findByLabelText } = render(<MarketplaceCollectionsRoute />);

    const action = await findByLabelText('Manage in tools empty state');
    expect(action).toBeTruthy();
    expect(mockEmptyStateAction).toEqual(expect.any(Function));
    mockEmptyStateAction?.();

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-tools',
      params: { tab: 'savedSearches' },
    });
  });

  it('shows the sign-in state without calling protected collection APIs when unauthenticated', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };

    const { findByText } = render(<MarketplaceCollectionsRoute />);

    expect(await findByText('Sign in to view saved marketplace')).toBeTruthy();
    expect(getMarketplaceCollections).not.toHaveBeenCalled();
    expect(getMarketplaceSavedSearches).not.toHaveBeenCalled();
  });

  it('opens shared input-backed collection creation fields', async () => {
    const { findByText, getByPlaceholderText } = render(<MarketplaceCollectionsRoute />);

    fireEvent.press(await findByText('Create collection'));

    expect(getByPlaceholderText('Weekend projects')).toBeTruthy();
    expect(getByPlaceholderText('Optional note')).toBeTruthy();
  });

  it('opens collection rows from HeroUI Native-backed collection cards', async () => {
    const { findByText } = render(<MarketplaceCollectionsRoute />);

    fireEvent.press(await findByText('Garden kit'));

    expect(getMarketplaceCollectionItems).toHaveBeenCalledWith(1, null, 50);
  });
});
