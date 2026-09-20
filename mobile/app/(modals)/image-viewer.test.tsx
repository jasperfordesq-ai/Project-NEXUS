// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

let mockParams: { uri?: string; title?: string } = {
  uri: 'https://example.test/photo.jpg',
  title: 'Community photo',
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'imageViewer.close': 'Close',
        'imageViewer.share': 'Share image',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('expo-image', () => ({
  Image: 'View',
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

import { Share } from 'react-native';
const mockToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));

import ImageViewerScreen from './image-viewer';

describe('ImageViewerScreen', () => {
  beforeEach(() => {
    jest.requireMock('expo-router').router.back.mockClear();
    mockParams = {
      uri: 'https://example.test/photo.jpg',
      title: 'Community photo',
    };
  });

  it('renders the close and share controls', () => {
    const { getByLabelText } = render(<ImageViewerScreen />);
    expect(getByLabelText('Close')).toBeTruthy();
    expect(getByLabelText('Share image')).toBeTruthy();
  });

  it('navigates back when no image URI is provided', () => {
    mockParams = {};
    render(<ImageViewerScreen />);
    expect(jest.requireMock('expo-router').router.back).toHaveBeenCalled();
  });
});

it('contains a failed native share and leaves the image open', async () => {
  mockParams = { uri: 'https://example.test/photo.jpg', title: 'Community photo' };
  jest.spyOn(Share, 'share').mockRejectedValueOnce(new Error('share unavailable'));
  const screen = render(<ImageViewerScreen />);
  let button = screen.getByLabelText('Share image');
  while (!button.props.onPress) button = button.parent!;
  await act(async () => { await button.props.onPress(); });
  expect(mockToast).toHaveBeenCalled();
  expect(screen.getByLabelText('Close')).toBeTruthy();
});

it('offers a new image load after failure without closing the viewer', () => {
  mockParams = { uri: 'https://example.test/missing.jpg', title: 'Missing photo' };
  const screen = render(<ImageViewerScreen />);
  fireEvent(screen.getByTestId('viewer-image'), 'error', { error: 'unavailable' });
  expect(screen.queryByTestId('viewer-image')).toBeNull();
  fireEvent.press(screen.getByText('common:buttons.retry'));
  expect(screen.getByTestId('viewer-image')).toBeTruthy();
  expect(screen.getByLabelText('Close')).toBeTruthy();
});
