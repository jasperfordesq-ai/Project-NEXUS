// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text, View } from 'react-native';
import { t as translate } from 'i18next';
import Button from '@/components/ui/Button';
import { reportException } from '@/lib/observability/report';
import { themeStore } from '@/lib/theme/themeStore';
import { DARK, LIGHT } from '@/lib/hooks/useTheme';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Fallback UI — must NOT use any context hooks (useTheme, useTenant, etc.)
 * because the ErrorBoundary sits OUTSIDE all providers in the component tree.
 * Uses hardcoded colors to guarantee it always renders.
 */
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const title = translate('errors.boundaryTitle', { ns: 'common' });
  const retry = translate('buttons.retry', { ns: 'common' });
  // This boundary sits outside the providers, but the theme store needs none: a dark-mode
  // crash used to flash a white screen with near-black text.
  const palette = themeStore.getSnapshot() === 'dark' ? DARK : LIGHT;

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: palette.bg,
      }}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: '600',
          color: palette.text,
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Button
        size="md"
        onPress={onReset}
        accessibilityLabel={retry}
        style={{ minWidth: 120 }}
      >
        {retry}
      </Button>
    </View>
  );
}

/**
 * Class-based error boundary — React hooks (including useTranslation) cannot
 * be used in class components. The ErrorFallback functional component above
 * handles i18n. The class itself uses no user-visible strings.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 🔴 "Always report to Sentry so errors are tracked in all environments" is what
    // this used to say and do. It was not true of any environment that mattered:
    // Sentry has no DSN in ANY of the six build profiles, so a crash on a member's
    // phone produced nothing, anywhere. This is the app's crash boundary — the single
    // most important report it makes — and it was going into a void.
    //
    // reportException still calls Sentry (a no-op without a DSN) AND posts to our own
    // API, which needs no account and lands in the server log where PHP Sentry is
    // live and triaged nightly. See lib/observability/report.ts.
    reportException(error, { componentStack: info.componentStack ?? '' });

    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallback onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}
