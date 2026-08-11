// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Feature Error Boundary
 * Catches errors in feature sections without crashing the entire app
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { motion } from '@/lib/motion';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import i18n from 'i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { logError } from '@/lib/logger';

interface FeatureErrorBoundaryProps {
  children: ReactNode;
  /** Internal telemetry tag. Never render this value: route declarations may use stable English identifiers. */
  featureName: string;
  fallback?: ReactNode;
  onRetry?: () => void;
}

interface FeatureErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  constructor(props: FeatureErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<FeatureErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Dev console only — logError now forwards to Sentry in production, so
    // calling it here in prod too would double-report alongside the explicit
    // captureSentryException below.
    if (import.meta.env.DEV) {
      logError(`Feature error in ${this.props.featureName}`, { error, errorInfo });
    }

    // Production crash visibility. 🔴 NOT consent-gated: this comment used to say
    // "captureSentryException no-ops unless the user granted analytics consent",
    // which was true when it was written and became false the same day crash
    // reporting was deliberately decoupled from analytics consent. A crash is
    // reported whatever the member chose; their identity, performance tracing and
    // session replay are what stay gated. Mirrors ErrorBoundary.tsx so a
    // render crash in an authenticated feature route (Wallet, Listings, Events,
    // Groups, Messages — the ~169 <FeatureErrorBoundary> wraps) surfaces in
    // Sentry instead of vanishing. The feature tag makes crashes filterable per
    // module.
    void import('@/lib/sentry').then(({ captureSentryException }) => {
      captureSentryException(error, {
        feature: this.props.featureName,
        componentStack: errorInfo.componentStack ?? undefined,
        source: 'FeatureErrorBoundary',
      });
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4"
        >
          <GlassCard role="alert" className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/20 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-theme-primary mb-2">
              {i18n.t('error_boundary.title', { ns: 'common' })}
            </h3>
            <p className="text-theme-muted text-sm mb-4">
              {i18n.t('error_boundary.description', { ns: 'common' })}
            </p>
            <Button
              variant="tertiary"
              className="bg-theme-elevated text-theme-primary"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={this.handleRetry}
            >
              {i18n.t('error_boundary.try_again', { ns: 'common' })}
            </Button>
          </GlassCard>
        </motion.div>
      );
    }

    return this.props.children;
  }
}

export default FeatureErrorBoundary;
