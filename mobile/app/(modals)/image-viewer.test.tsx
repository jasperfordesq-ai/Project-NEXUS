// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

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
