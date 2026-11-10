// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Error Boundary Component
 * Catches React errors and displays a fallback UI
 */

import { Component, Suspense, lazy, type ReactNode, type ErrorInfo } from 'react';
import { motion } from '@/lib/motion';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Home from 'lucide-react/icons/house';

import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { logError } from '@/lib/logger';
import { isSharedPlatformHost } from '@/lib/tenant-routing';
import i18n from 'i18next';

const ReportProblemButton = lazy(() =>
  import('@/components/feedback/ReportProblemButton').then((module) => ({
    default: module.ReportProblemButton,
  })),
);

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showReportProblem?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    // Log to console in development only — logError now forwards to Sentry in
    // production, so guarding this prevents a duplicate of the explicit
    // captureSentryException report below.
    if (import.meta.env.DEV) {
      logError('Error Boundary caught an error', { error, errorInfo });
    }

    // Report to Sentry in production
    void import('@/lib/sentry').then(({ captureSentryException }) => {
      captureSentryException(error, {
        componentStack: errorInfo.componentStack ?? undefined,
        source: 'ErrorBoundary',
      });
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    // On custom domains (e.g. hour-timebank.ie) the domain IS the tenant identifier —
    // the slug must NOT appear in the path. Only prepend slug on shared hosts where
    // path-based routing is required (localhost, app.project-nexus.ie).
    const hostname = window.location.hostname;
    const isSharedHost = isSharedPlatformHost(hostname);

    if (!isSharedHost) {
      window.location.href = '/';
      return;
    }

    // Validate stored slug before using it to prevent open-redirect via a
    // poisoned localStorage value (must be alphanumeric/hyphens, 2–50 chars,
    // and not a reserved path segment).
    const storedSlug = localStorage.getItem('nexus_tenant_slug');
    const RESERVED = new Set(['admin', 'api', 'login', 'register', 'static', 'assets']);
    const safeSlug =
      storedSlug &&
      /^[a-z0-9-]{2,50}$/.test(storedSlug) &&
      !RESERVED.has(storedSlug)
        ? storedSlug
        : null;
    window.location.href = safeSlug ? `/${safeSlug}/` : '/';
  };

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          data-prerender-error-boundary="true"
          className="min-h-screen flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md relative z-10"
          >
            <GlassCard className="p-8">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
                  <AlertTriangle className="w-8 h-8 text-red-400" aria-hidden="true" />
                </div>

                <h1 className="text-2xl font-bold text-theme-primary mb-2">
                  {i18n.t('error_boundary.title', { ns: 'common' })}
                </h1>

                <p className="text-theme-muted mb-6">
                  {i18n.t('error_boundary.description', { ns: 'common' })}
                </p>

                {/* Error details in development */}
                {import.meta.env.DEV && this.state.error && (
                  <div className="mb-6 p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-left">
                    <p className="text-red-400 text-sm font-mono break-all">
                      {this.state.error.message}
                    </p>
                    {this.state.errorInfo?.componentStack && (
                      <details className="mt-2">
                        <summary className="text-theme-subtle text-xs cursor-pointer">
                          {i18n.t('error_boundary.component_stack', { ns: 'common' })}
                        </summary>
                        <pre className="text-theme-subtle/70 text-xs mt-2 overflow-auto max-h-40">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Button
                    onPress={this.handleTryAgain}
                    className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                    startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  >
                    {i18n.t('error_boundary.try_again', { ns: 'common' })}
                  </Button>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {this.props.showReportProblem !== false ? (
                      <Suspense fallback={null}>
                        <ReportProblemButton className="w-full" />
                      </Suspense>
                    ) : null}

                    <Button
                      onPress={this.handleGoHome}
                      variant="tertiary"
                      className="w-full bg-theme-elevated text-theme-muted"
                      startContent={<Home className="w-4 h-4" aria-hidden="true" />}
                    >
                      {i18n.t('error_boundary.go_home', { ns: 'common' })}
                    </Button>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
