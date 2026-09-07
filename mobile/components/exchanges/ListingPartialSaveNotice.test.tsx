// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000', textSecondary: '#555', textMuted: '#777', warning: '#aa4c00',
    bg: '#fff', surface: '#fff', border: '#ddd',
  }),
}));

import ListingPartialSaveNotice from './ListingPartialSaveNotice';

const labels = {
  title: 'Your listing is saved',
  tags: 'The skills could not be saved.',
  image: 'The photo could not be saved.',
  retry: 'Try the rest again',
  continueLabel: 'Continue without them',
};

describe('ListingPartialSaveNotice', () => {
  /**
   * 🔴 Audit 2026-09-06, F06. The member has to be able to tell what DID save from what
   * did not, or the only safe-looking action is to fill the form in again — which on the
   * create screen posts a second listing.
   */
  it('names only the write that actually failed', () => {
    const { getByText, queryByText } = render(
      <ListingPartialSaveNotice
        tagsFailed
        imageFailed={false}
        isRetrying={false}
        onRetry={jest.fn()}
        onContinue={jest.fn()}
        {...labels}
      />,
    );

    expect(getByText(labels.title)).toBeTruthy();
    expect(getByText(labels.tags)).toBeTruthy();
    expect(queryByText(labels.image)).toBeNull();
  });

  it('names both when both failed', () => {
    const { getByText } = render(
      <ListingPartialSaveNotice
        tagsFailed
        imageFailed
        isRetrying={false}
        onRetry={jest.fn()}
        onContinue={jest.fn()}
        {...labels}
      />,
    );

    expect(getByText(labels.tags)).toBeTruthy();
    expect(getByText(labels.image)).toBeTruthy();
  });

  it('offers a retry and a way to move on', () => {
    const onRetry = jest.fn();
    const onContinue = jest.fn();
    const { getByTestId } = render(
      <ListingPartialSaveNotice
        tagsFailed
        imageFailed={false}
        isRetrying={false}
        onRetry={onRetry}
        onContinue={onContinue}
        {...labels}
      />,
    );

    fireEvent.press(getByTestId('listing-partial-save-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('listing-partial-save-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
