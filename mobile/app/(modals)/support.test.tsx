// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

import SupportRoute from './support';

let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});

/** The order the screen renders them in — the pills all share one label. */
const ITEM_ORDER = ['help', 'resources', 'about', 'contact', 'terms', 'privacy', 'cookies', 'accessibility',
  'communityGuidelines', 'acceptableUse', 'trust'];

const EXPECTED_ROUTES: Record<string, unknown> = {
  help: '/(modals)/help-faqs',
  resources: '/(modals)/resources',
  about: { pathname: '/(modals)/static-page', params: { key: 'about' } },
  contact: { pathname: '/(modals)/static-page', params: { key: 'contact' } },
  terms: { pathname: '/(modals)/legal-document', params: { type: 'terms' } },
  privacy: { pathname: '/(modals)/legal-document', params: { type: 'privacy' } },
  cookies: { pathname: '/(modals)/legal-document', params: { type: 'cookies' } },
  accessibility: { pathname: '/(modals)/legal-document', params: { type: 'accessibility' } },
  communityGuidelines: { pathname: '/(modals)/legal-document', params: { type: 'community_guidelines' } },
  acceptableUse: { pathname: '/(modals)/legal-document', params: { type: 'acceptable_use' } },
  trust: { pathname: '/(modals)/static-page', params: { key: 'trust-safety' } },
};

describe('SupportRoute', () => {
  beforeEach(() => {
    mockSearchParams = {};
    jest.clearAllMocks();
  });

  it('renders every support and legal destination', () => {
    const { getByText } = render(<SupportRoute />);

    expect(getByText('Support & legal')).toBeTruthy();
    expect(getByText('Help center')).toBeTruthy();
    expect(getByText('Resources')).toBeTruthy();
    expect(getByText('Contact')).toBeTruthy();
    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('Accessibility')).toBeTruthy();
    expect(getByText('Trust & safety')).toBeTruthy();
  });

  /*
    🔴 THE point of this screen's rewrite. Eight of the nine items used to call
    `Linking.openURL(buildWebUrl(...))`, so a member reading their community's
    privacy policy was thrown out of the app into a browser — and on a device
    with no browser configured, nowhere at all. Pressing every item and asserting
    the hand-off never happens is what stops that coming back one item at a time.
  */
  it('opens every item natively and never hands the member to a browser', () => {
    const { router } = require('expo-router');
    const { getAllByText } = render(<SupportRoute />);

    const pills = getAllByText('Open page');
    expect(pills).toHaveLength(ITEM_ORDER.length);

    pills.forEach((pill) => fireEvent.press(pill));

    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(ITEM_ORDER.length);

    ITEM_ORDER.forEach((key, index) => {
      expect(router.push).toHaveBeenNthCalledWith(index + 1, EXPECTED_ROUTES[key]);
    });
  });

  it('has no browser hand-off left in its source at all', () => {
    /*
      A behavioural assertion alone would pass if a hand-off were added behind a
      condition the test does not reach — a long-press, an error path, a feature
      flag. Reading the file closes that door.
    */
    const source = fs.readFileSync(path.join(__dirname, 'support.tsx'), 'utf8');
    // Comments are allowed to name what they forbid — the code is what matters.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/expo-linking/);
    expect(code).not.toMatch(/openURL/);
    expect(code).not.toMatch(/buildWebUrl/);
    expect(code).not.toMatch(/https?:\/\//);
  });

  it('no longer offers the invented policy summary sheet', () => {
    const { queryByText, queryByTestId } = render(<SupportRoute />);

    expect(queryByText('Open web')).toBeNull();
    expect(queryByText('Read in app')).toBeNull();
    expect(queryByTestId('support-document-sheet')).toBeNull();
  });

  /*
    `app/+native-intent.ts` maps `/privacy`, `/terms`, `/trust-and-safety` and the
    rest onto `/(modals)/support?doc=…`. That file is owned elsewhere and still
    sends the parameter, so a deep link must still land on the document itself
    rather than on this menu.
  */
  it.each([
    ['privacy', { pathname: '/(modals)/legal-document', params: { type: 'privacy' } }],
    ['terms', { pathname: '/(modals)/legal-document', params: { type: 'terms' } }],
    ['trust', { pathname: '/(modals)/static-page', params: { key: 'trust-safety' } }],
    ['trust-and-safety', { pathname: '/(modals)/static-page', params: { key: 'trust-safety' } }],
    ['about', { pathname: '/(modals)/static-page', params: { key: 'about' } }],
  ])('follows the ?doc=%s deep link straight to the real document', (doc, expected) => {
    const { router } = require('expo-router');
    mockSearchParams = { doc };

    render(<SupportRoute />);

    expect(router.push).toHaveBeenCalledWith(expected);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('follows a deep link once, so returning from the document is not a trap', () => {
    const { router } = require('expo-router');
    mockSearchParams = { doc: 'privacy' };

    const { rerender } = render(<SupportRoute />);
    rerender(<SupportRoute />);
    rerender(<SupportRoute />);

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('ignores a ?doc value it has no destination for', () => {
    const { router } = require('expo-router');
    mockSearchParams = { doc: 'community_guidelines' };

    const { getByText } = render(<SupportRoute />);

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Support & legal')).toBeTruthy();
  });
});
