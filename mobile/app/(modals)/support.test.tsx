// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' } }),
}));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@gorhom/bottom-sheet', () => {
  const { ScrollView } = require('react-native');
  return { BottomSheetScrollView: ScrollView };
});
jest.mock('@/components/ui/BottomSheet', () => {
  const { View, Text } = require('react-native');
  return function MockBottomSheet({ visible, title, children }: { visible: boolean; title?: string; children: React.ReactNode }) {
    if (!visible) return null;
    return (
      <View testID="support-document-sheet">
        {title ? <Text>{title}</Text> : null}
        {children}
      </View>
    );
  };
});
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});

describe('SupportRoute', () => {
  beforeEach(() => {
    mockSearchParams = {};
    jest.clearAllMocks();
  });

  it('renders support and legal destinations', () => {
    const { getByText } = render(<SupportRoute />);

    expect(getByText('Support & legal')).toBeTruthy();
    expect(getByText('Help center')).toBeTruthy();
    expect(getByText('Resources')).toBeTruthy();
    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('Accessibility')).toBeTruthy();
    expect(getByText('Trust & safety')).toBeTruthy();
  });

  it('opens selected web support pages externally', () => {
    const { getAllByText } = render(<SupportRoute />);

    fireEvent.press(getAllByText('Open web')[0]);

    expect(Linking.openURL).toHaveBeenCalledWith('https://app.project-nexus.ie/hour-timebank/help');
  });

  it('opens the community\'s REAL privacy document, not a generic summary of one', () => {
    /*
      🔴 S3-06: "Read in app" for Terms, Privacy and Cookies showed three fixed translated
      paragraphs — not the community's own legal text, which is what the acceptance gate
      enforces. A member could believe they had read their community's terms when they had
      read generic copy (audit 2026-09-06).
    */
    const { router } = require('expo-router');
    router.push.mockClear();
    const { getAllByText, queryByTestId } = render(<SupportRoute />);

    // Order follows SUPPORT_LINKS: about, contact, terms, privacy, cookies, …
    fireEvent.press(getAllByText('Read in app')[3]);

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/legal-document',
      params: { type: 'privacy' },
    });
    // And the generic summary sheet does NOT open in its place.
    expect(queryByTestId('support-document-sheet')).toBeNull();
  });

  it('keeps the in-app summary for the pages that have no legal document', () => {
    const { getAllByText, getByTestId, queryByTestId } = render(<SupportRoute />);

    // Sheet is closed until "Read in app" is tapped — the document used to
    // render at the TOP of the scroll view, invisible from further down the
    // page (looked like a dead button).
    expect(queryByTestId('support-document-sheet')).toBeNull();

    fireEvent.press(getAllByText('Read in app')[0]);

    expect(getByTestId('support-document-sheet')).toBeTruthy();
    // The title appears in the row and again in the sheet; the sheet's own body is the proof.
    expect(getAllByText('About Project NEXUS').length).toBeGreaterThan(1);

    // The sheet's own "Open web" action is rendered last in the tree
    const openWebButtons = getAllByText('Open web');
    fireEvent.press(openWebButtons[openWebButtons.length - 1]);

    expect(Linking.openURL).toHaveBeenCalledWith('https://app.project-nexus.ie/hour-timebank/about');
  });

  it('opens a requested legal document from native route params', () => {
    mockSearchParams = { doc: 'terms' };

    const { getByText } = render(<SupportRoute />);

    expect(getByText('Terms of use summary')).toBeTruthy();
    expect(getByText('Use the platform responsibly')).toBeTruthy();
  });
});
