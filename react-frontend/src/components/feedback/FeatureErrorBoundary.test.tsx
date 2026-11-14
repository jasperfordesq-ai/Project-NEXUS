// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { FeatureErrorBoundary } from './FeatureErrorBoundary';
import { captureSentryException } from '@/lib/sentry';

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

vi.mock('@/lib/sentry', () => ({
  captureSentryException: vi.fn(),
}));

function ThrowingComponent() {
  throw new Error('Feature error');
}

const originalConsoleError = console.error;

describe('FeatureErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error', () => {
    render(
      <FeatureErrorBoundary featureName="Dashboard">
        <div>Feature Content</div>
      </FeatureErrorBoundary>
    );
    expect(screen.getByText('Feature Content')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    render(
      <FeatureErrorBoundary featureName="Dashboard">
        <ThrowingComponent />
      </FeatureErrorBoundary>
    );
    expect(screen.getByText("That didn't work — sorry")).toBeInTheDocument();
    expect(screen.getByText("We hit a problem on our side. Try again, or go back to the home page.")).toBeInTheDocument();
    expect(screen.queryByText(/Dashboard/i)).not.toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <FeatureErrorBoundary featureName="Widget" fallback={<div>Widget unavailable</div>}>
        <ThrowingComponent />
      </FeatureErrorBoundary>
    );
    expect(screen.getByText('Widget unavailable')).toBeInTheDocument();
  });

  it('shows Try Again button in error state', () => {
    render(
      <FeatureErrorBoundary featureName="Feed">
        <ThrowingComponent />
      </FeatureErrorBoundary>
    );
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it('reports the crash to Sentry tagged with the feature name', async () => {
    render(
      <FeatureErrorBoundary featureName="Wallet">
        <ThrowingComponent />
      </FeatureErrorBoundary>
    );

    await vi.waitFor(() => expect(captureSentryException).toHaveBeenCalledTimes(1));
    const [reportedError, context] = vi.mocked(captureSentryException).mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError.message).toBe('Feature error');
    expect(context).toMatchObject({
      feature: 'Wallet',
      source: 'FeatureErrorBoundary',
    });
  });

  it('does not report to Sentry when children render successfully', () => {
    render(
      <FeatureErrorBoundary featureName="Dashboard">
        <div>All good</div>
      </FeatureErrorBoundary>
    );
    expect(captureSentryException).not.toHaveBeenCalled();
  });
});
