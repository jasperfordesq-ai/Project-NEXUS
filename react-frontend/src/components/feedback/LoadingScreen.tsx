// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Loading Screen Component
 * Full-page loading indicator
 */

import i18n from 'i18next';
import { Spinner } from '@/components/ui/Spinner';

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
      {/* HeroUI's Spinner in the community colour, turning calmly and still
          under reduced motion (warmth plan Phase 4 A3). Replaced a card whose
          whole tile span round the spinner in a fixed cyan. */}
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <Spinner size="lg" color="accent" className="animate-[spin_1.4s_linear_infinite] motion-reduce:animate-none" />
        <p className="text-sm font-medium text-theme-secondary">{displayMessage}</p>
        <span className="sr-only">{displayMessage}</span>
      </div>
    </div>
  );
}

export default LoadingScreen;
