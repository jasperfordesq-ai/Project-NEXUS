// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import ImageCarousel from './ImageCarousel';

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

describe('ImageCarousel', () => {
  it('fits the measured card width and shows a placeholder for a failed image', () => {
    const { getByTestId } = render(<ImageCarousel images={[{ uri: 'https://example.test/one.jpg' }]} />);
    fireEvent(getByTestId('image-carousel'), 'layout', { nativeEvent: { layout: { width: 280 } } });
    expect(getByTestId('carousel-image-0').props.style.width).toBe(280);
    fireEvent(getByTestId('carousel-image-0'), 'error');
    expect(getByTestId('carousel-image-0-fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders nothing when no images are available', () => {
    const { queryByTestId } = render(<ImageCarousel images={[]} />);
    expect(queryByTestId('image-carousel')).toBeNull();
  });

  it('uses translated fallback accessibility labels for unnamed images', () => {
    const onImagePress = jest.fn();
    const { getByLabelText } = render(
      <ImageCarousel
        images={[
          { uri: 'https://example.test/one.jpg' },
          { uri: 'https://example.test/two.jpg' },
        ]}
        onImagePress={onImagePress}
      />,
    );

    fireEvent.press(getByLabelText('Image 1 of 2'));

    expect(onImagePress).toHaveBeenCalledWith(0);
  });

  it('uses provided alt text when available', () => {
    const { getByLabelText } = render(
      <ImageCarousel images={[{ uri: 'https://example.test/one.jpg', alt: 'Community garden' }]} />,
    );

    expect(getByLabelText('Community garden')).toBeTruthy();
  });
});
