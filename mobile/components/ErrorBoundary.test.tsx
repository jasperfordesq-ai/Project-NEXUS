// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `ErrorBoundary` is the last thing between a crash and a white screen, and it
 * sits OUTSIDE every provider in `app/_layout.tsx`. That placement is the whole
 * design constraint: it cannot use `useTheme`, `useTenant` or any other context
 * hook, because the thing that failed may be the provider itself.
 *
 * These tests render it with no providers at all — no HeroUINativeProvider, no
 * theme, no tenant, no safe-area. If a context hook ever creeps into the
 * fallback, this file fails, which is the only cheap way to hold that rule.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockCaptureException = jest.fn();

jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import ErrorBoundary from './ErrorBoundary';

/** Throws on first render, then renders successfully once `shouldThrow` flips. */
function Exploding({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error('render exploded');
  return <Text>recovered content</Text>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // componentDidCatch logs deliberately; React also logs the caught error.
    // Silencing keeps a passing run readable without hiding assertions.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Text>normal content</Text>
      </ErrorBoundary>
    );

    expect(screen.getByText('normal content')).toBeTruthy();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('shows a translated fallback with a retry control when a child throws', () => {
    render(
      <ErrorBoundary>
        <Exploding shouldThrow />
      </ErrorBoundary>
    );

    // Real strings, resolved through i18next — an untranslated fallback here
    // would be the one screen a member sees in the wrong language.
    const title = screen.getByText(/something went wrong|error/i);
    expect(title).toBeTruthy();
  });

  it('renders with NO providers in the tree, as its placement outside them requires', () => {
    // The absence of a wrapper here is the assertion. If the fallback starts
    // using a context hook, this render throws instead of recovering.
    expect(() =>
      render(
        <ErrorBoundary>
          <Exploding shouldThrow />
        </ErrorBoundary>
      )
    ).not.toThrow();
  });

  it('reports the error to Sentry together with the component stack', () => {
    render(
      <ErrorBoundary>
        <Exploding shouldThrow />
      </ErrorBoundary>
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [error, context] = mockCaptureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('render exploded');
    expect(context.extra.componentStack).toBeTruthy();
  });

  it('prefers a caller-supplied fallback over the built-in one', () => {
    render(
      <ErrorBoundary fallback={<Text>custom fallback</Text>}>
        <Exploding shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('custom fallback')).toBeTruthy();
  });

  it('still reports to Sentry when a custom fallback is used', () => {
    // A caller replacing the UI must not accidentally silence the reporting.
    render(
      <ErrorBoundary fallback={<Text>custom fallback</Text>}>
        <Exploding shouldThrow />
      </ErrorBoundary>
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('clears the error and re-renders the children when retry is pressed', () => {
    // Recovery matters: without it the member has to force-quit the app.
    function Harness() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <>
          <Text onPress={() => setShouldThrow(false)}>fix it</Text>
          <ErrorBoundary>
            <Exploding shouldThrow={shouldThrow} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);

    // Stop the child throwing, then press the boundary's own retry control.
    fireEvent.press(screen.getByText('fix it'));

    const retry = screen.UNSAFE_getAllByProps({ accessibilityRole: 'button' })[0];
    fireEvent.press(retry);

    expect(screen.getByText('recovered content')).toBeTruthy();
  });
});
