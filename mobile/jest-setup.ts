// Jest setup
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Initialise i18next synchronously with English translations so that
// useTranslation() / t() returns real strings in all tests.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enMessages from './locales/en/messages.json';
import enHome from './locales/en/home.json';
import enMembers from './locales/en/members.json';
import enExchanges from './locales/en/exchanges.json';
import enEvents from './locales/en/events.json';
import enEventTemplates from './locales/en/event_templates.json';
import enEventTickets from './locales/en/event_tickets.json';
import enEventRecurrenceBlueprints from './locales/en/event_recurrence_blueprints.json';
import enNotifications from './locales/en/notifications.json';
import enSettings from './locales/en/settings.json';
import enWallet from './locales/en/wallet.json';
import enProfile from './locales/en/profile.json';
import enSearch from './locales/en/search.json';
import enBlog from './locales/en/blog.json';
import enGroups from './locales/en/groups.json';
import enGamification from './locales/en/gamification.json';
import enGoals from './locales/en/goals.json';
import enChat from './locales/en/chat.json';
import enVolunteering from './locales/en/volunteering.json';
import enOrganisations from './locales/en/organisations.json';
import enEndorsements from './locales/en/endorsements.json';
import enFederation from './locales/en/federation.json';
import { Uniwind } from 'uniwind';

// Jest does not run Metro, so global.css is not compiled into Uniwind's native
// variable store. Seed the HeroUI Native tokens exercised by shared controls so
// useThemeColor returns real colours instead of the library's `invalid` sentinel.
const heroUiTestTheme = {
  '--color-accent': '#6366f1',
  '--color-accent-foreground': '#ffffff',
  '--color-accent-hover': '#4f46e5',
  '--color-default-hover': '#e5e7eb',
  '--color-default-foreground': '#111827',
  '--color-danger': '#dc2626',
  '--color-danger-hover': '#b91c1c',
  '--color-danger-soft-hover': '#fee2e2',
  '--color-success': '#16a34a',
  '--color-warning': '#d97706',
};

Uniwind.updateCSSVariables('light', heroUiTestTheme);
Uniwind.updateCSSVariables('dark', heroUiTestTheme);

i18n.use(initReactI18next).init({
  // Suppress the i18next "made possible by Locize" promo log in tests
  debug: false,
  resources: {
    en: {
      common: enCommon,
      auth: enAuth,
      messages: enMessages,
      home: enHome,
      members: enMembers,
      exchanges: enExchanges,
      events: enEvents,
      event_templates: enEventTemplates,
      event_tickets: enEventTickets,
      event_recurrence_blueprints: enEventRecurrenceBlueprints,
      notifications: enNotifications,
      settings: enSettings,
      wallet: enWallet,
      profile: enProfile,
      search: enSearch,
      blog: enBlog,
      groups: enGroups,
      gamification: enGamification,
      goals: enGoals,
      chat: enChat,
      volunteering: enVolunteering,
      organisations: enOrganisations,
      endorsements: enEndorsements,
      federation: enFederation,
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'auth',
    'messages',
    'home',
    'members',
    'exchanges',
    'events',
    'event_templates',
    'event_tickets',
    'event_recurrence_blueprints',
    'notifications',
    'settings',
    'wallet',
    'profile',
    'search',
    'blog',
    'groups',
    'gamification',
    'goals',
    'chat',
    'volunteering',
    'organisations',
    'endorsements',
    'federation',
  ],
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
  initAsync: false,
});

// Mock expo-router
jest.mock('expo-router', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
    }),
    useSegments: () => ['(tabs)'],
    Link: 'Link',
    router: {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
    }
}));

// Mock secure store
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock @/lib/haptics globally so Button.tsx and other components get complete
// ImpactFeedbackStyle/NotificationFeedbackType enums even when individual test
// files partially override the expo-haptics mock.
jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock react-native-safe-area-context so screens using useSafeAreaInsets
// work without a SafeAreaProvider in the test tree.
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    useSafeAreaInsets: () => insets,
    SafeAreaProvider: ({ children }: { children: import('react').ReactNode }) => children,
    SafeAreaView: View,
    SafeAreaConsumer: ({ children }: {
      children: (value: typeof insets) => import('react').ReactNode;
    }) =>
      children(insets),
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

// Mock shared UI components used across screen tests
jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/TenantBanner', () => () => null);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  SkeletonBox: () => null,
  FeedItemSkeleton: () => null,
  ConversationSkeleton: () => null,
  EventCardSkeleton: () => null,
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
  GroupCardSkeleton: () => null,
}));
