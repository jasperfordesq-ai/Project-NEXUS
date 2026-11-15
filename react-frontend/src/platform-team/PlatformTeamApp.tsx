// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — entry point (lazy-loaded from routes/AppRoutes.tsx).
 *
 * Guard, frame and routes for `/platform-team` in their own chunk, so the
 * panel stays out of the member bundle.
 */

import { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { LoadingScreen } from '@/components/feedback';
import { PlatformTeamRoute } from './PlatformTeamRoute';
import { PlatformTeamLayout } from './PlatformTeamLayout';
import { PlatformTeamRoutes } from './PlatformTeamRoutes';

function PlatformTeamAppInner() {
  const { ready, t } = useTranslation(['platform_team', 'admin_nav']);

  if (!ready) {
    return <LoadingScreen message={t('platform_team:layout.loading')} />;
  }

  return (
    <Routes>
      <Route element={<PlatformTeamRoute />}>
        <Route element={<PlatformTeamLayout />}>
          {PlatformTeamRoutes()}
        </Route>
      </Route>
    </Routes>
  );
}

export default function PlatformTeamApp() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <PlatformTeamAppInner />
      </Suspense>
    </ErrorBoundary>
  );
}
