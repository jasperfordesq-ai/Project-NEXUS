// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('@/lib/motion', () => {
  const handler = {
    get: (_: unknown, tag: string) => {
      return ({ children, _initial, _animate, _exit, _transition, _variants, _whileHover, _whileTap, ...rest }: Record<string, unknown>) => {
        const Tag = typeof tag === 'string' ? tag : 'div';
        return <Tag {...rest}>{children}</Tag>;
      };
    },
  };
  return {
    motion: new Proxy({}, handler),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/components/feedback/ReportProblemButton', () => ({
  ReportProblemButton: () => <button type="button">Report a problem</button>,
}));

// componentDidCatch reports through a dynamic import('@/lib/sentry'). Unmocked,
// that pulls in sentry -> cookieConsentStorage -> safeStorage after the test has
// finished; on a slow CI runner the load lands after environment teardown and
// Vitest fails the shard with EnvironmentTeardownError, though every test passed.
vi.mock('@/lib/sentry', () => ({
  captureSentryException: vi.fn(),
}));

// A component that always throws
function ThrowingComponent() {
  throw new Error('Test error');
}

// Suppress console.error for expected error boundary output
const originalConsoleError = console.error;

describe('ErrorBoundary', () => {
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Normal Content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Normal Content')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom Error')).toBeInTheDocument();
  });

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('shows Try Again and Go Home buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Go Home')).toBeInTheDocument();
  });

  it('shows a report problem action in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument();
  });

  it('can render provider-safe fallback UI without the report problem action', () => {
    render(
      <ErrorBoundary showReportProblem={false}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });
});
