// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The fallback screen for a link the app cannot open.
 *
 * What matters here is not that it renders an apology — it is that it always offers a
 * way OUT. Before this route existed, an unmatched deep link fell through to Expo
 * Router's own "Unmatched Route" diagnostic, and a signed-in member was left sitting
 * on it because `decideAuthRedirect` treats an unmatched path as a real route to
 * preserve. So the assertions below are mostly about the two exits working.
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockPathname = '/courses/42';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(), canGoBack: jest.fn(() => false) },
  usePathname: () => mockPathname,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:notFound.shortTitle': 'Link not opened',
        'common:notFound.title': 'This link cannot be opened in the app',
        'common:notFound.subtitle': 'That page is not available in the app yet.',
        'common:notFound.openInBrowser': 'Open in browser',
        'common:notFound.goHome': 'Go to home',
        'common:buttons.back': 'Back',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});

import NotFoundRoute from './+not-found';

describe('the unmatched-link screen', () => {
  // 🔴 A spy on the real module, NOT jest.mock of an internal RN path. The screen
  // imports `{ Linking } from 'react-native'`, so mocking
  // 'react-native/Libraries/Linking/Linking' intercepted nothing and every assertion
  // about openURL passed vacuously against a function that was never called.
  let mockOpenURL: jest.SpyInstance;

  beforeEach(() => {
    mockReplace.mockClear();
    mockPathname = '/courses/42';
    mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    mockOpenURL.mockRestore();
  });

  it('explains the situation instead of showing a framework error', () => {
    render(<NotFoundRoute />);

    expect(screen.getByText('This link cannot be opened in the app')).toBeTruthy();
    expect(screen.getByText('That page is not available in the app yet.')).toBeTruthy();
    // The bar carries a SHORT title, so the same sentence is not printed twice. The
    // first version of this screen used one string for both and this test caught it.
    expect(screen.getByText('Link not opened')).toBeTruthy();
  });

  it('🔴 offers both exits, so the member is never stranded', () => {
    render(<NotFoundRoute />);

    expect(screen.getByText('Open in browser')).toBeTruthy();
    expect(screen.getByText('Go to home')).toBeTruthy();
  });

  it('opens the page the member actually asked for, on the web origin', () => {
    // The unmatched pathname IS the web path — that is precisely why Expo Router could
    // not match it — so handing it back to the browser gets them the real page rather
    // than a generic home page.
    render(<NotFoundRoute />);

    fireEvent.press(screen.getByText('Open in browser'));

    expect(mockOpenURL).toHaveBeenCalledWith('https://app.project-nexus.ie/courses/42');
  });

  it('still builds a valid URL when the pathname has no leading slash', () => {
    mockPathname = 'courses/42';
    render(<NotFoundRoute />);

    fireEvent.press(screen.getByText('Open in browser'));

    expect(mockOpenURL).toHaveBeenCalledWith('https://app.project-nexus.ie/courses/42');
  });

  it('survives a device with no browser rather than replacing the screen with a crash', async () => {
    // Linking.openURL REJECTS when nothing can handle the URL. An unhandled rejection
    // here would take out the one screen offering a way forward.
    mockOpenURL.mockImplementationOnce(() => Promise.reject(new Error('no activity found')));
    render(<NotFoundRoute />);

    expect(() => fireEvent.press(screen.getByText('Open in browser'))).not.toThrow();
    await Promise.resolve();
  });

  it('goes home by REPLACING, so the dead link is not left in the back stack', () => {
    render(<NotFoundRoute />);

    fireEvent.press(screen.getByText('Go to home'));

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
  });
});
