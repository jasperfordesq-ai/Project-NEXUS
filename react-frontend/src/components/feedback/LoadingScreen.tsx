// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Loading Screen Component
 * Full-page loading indicator
 */

import i18n from 'i18next';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  const displayMessage = message ?? (
    i18n.isInitialized && i18n.hasLoadedNamespace('common')
      ? i18n.t('loading', { ns: 'common' })
      : 'Loading...'
  );
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={displayMessage}
    >
      {/* Three gently pulsing dots — the same shape as the start screen in
          index.html, now in the community's own colours (warmth plan Phase 4
          A3). Still under reduced motion. Replaced a card whose whole tile
          span round a spinner in a fixed cyan. */}
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <div className="flex items-center gap-2.5" aria-hidden="true">
          <span className="size-3 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
          <span className="size-3 rounded-full bg-companion animate-pulse [animation-delay:200ms] motion-reduce:animate-none" />
          <span className="size-3 rounded-full bg-accent-strong animate-pulse [animation-delay:400ms] motion-reduce:animate-none" />
        </div>
        <p className="text-sm font-medium text-theme-secondary">{displayMessage}</p>
        <span className="sr-only">{displayMessage}</span>
      </div>
    </div>
  );
}

export default LoadingScreen;
