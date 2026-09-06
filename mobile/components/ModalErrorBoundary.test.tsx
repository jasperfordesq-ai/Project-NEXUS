// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A crash inside a modal route must be REPORTED, not just drawn.
 *
 * Roughly 130 screens sit behind this boundary. Until the 2026-09-06 audit its
 * `componentDidCatch` only wrote to the console: the member saw "Something went wrong" and
 * the crash reached neither Sentry nor the API error log, so nobody could know it happened.
 * `ErrorBoundary` (the root one) had been reporting all along; this is the same fix.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockReportException = jest.fn();
jest.mock('@/lib/observability/report', () => ({
  reportException: (...args: unknown[]) => mockReportException(...args),
}));

jest.mock('i18next', () => ({
  t: (key: string) => key,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));

import ModalErrorBoundary from './ModalErrorBoundary';

function Exploding(): React.ReactElement {
  throw new Error('render exploded');
}

describe('ModalErrorBoundary', () => {
  const consoleError = console.error;

  beforeEach(() => {
    mockReportException.mockClear();
    // React logs the caught error itself; the noise is not what is under test.
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = consoleError;
  });

  it('reports a render crash so it reaches Sentry and the API error log', () => {
    render(
      <ModalErrorBoundary>
        <Exploding />
      </ModalErrorBoundary>,
    );

    expect(mockReportException).toHaveBeenCalledTimes(1);
    const [error, context] = mockReportException.mock.calls[0];
    expect((error as Error).message).toBe('render exploded');
    // The component stack is what makes the report actionable.
    expect(context).toHaveProperty('componentStack');
  });

  it('leaves a healthy screen alone', () => {
    const { getByText } = render(
      <ModalErrorBoundary>
        <Text>All well</Text>
      </ModalErrorBoundary>,
    );

    expect(getByText('All well')).toBeTruthy();
    expect(mockReportException).not.toHaveBeenCalled();
  });
});
