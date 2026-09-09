// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common:errors.refreshFailedTitle': 'Couldn’t refresh',
      'common:errors.refreshFailedSubtitle': 'You’re still seeing what loaded earlier.',
      'common:buttons.retry': 'Retry',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555', error: '#c00', errorBg: '#fee' }),
}));

import RefreshFailedNotice from './RefreshFailedNotice';

describe('RefreshFailedNotice', () => {
  it('shows nothing at all when the last refresh succeeded', () => {
    const { queryByTestId } = render(<RefreshFailedNotice error={null} />);
    expect(queryByTestId('refresh-failed-notice')).toBeNull();
  });

  /**
   * The whole point: rows are still on screen and out of date, and until now the member
   * was given no sign of it.
   */
  it('tells the member the rows are out of date, and offers to try again', () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = render(<RefreshFailedNotice error="Network error." onRetry={onRetry} />);

    expect(getByTestId('refresh-failed-notice')).toBeTruthy();
    expect(getByText('Couldn’t refresh')).toBeTruthy();
    expect(getByText('You’re still seeing what loaded earlier.')).toBeTruthy();

    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('announces itself to a screen reader rather than being a silent red box', () => {
    const { getByTestId } = render(<RefreshFailedNotice error="Network error." />);
    expect(getByTestId('refresh-failed-notice').props.accessibilityRole).toBe('alert');
  });

  it('offers no Retry when the screen has no way to re-run the request', () => {
    const { queryByText } = render(<RefreshFailedNotice error="Network error." />);
    expect(queryByText('Retry')).toBeNull();
  });

  it('does not fire a second request while the first retry is still running', () => {
    const onRetry = jest.fn();
    const { getByText } = render(<RefreshFailedNotice error="Network error." onRetry={onRetry} isRetrying />);
    fireEvent.press(getByText('Retry'));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
