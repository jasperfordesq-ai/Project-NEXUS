// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin App Entry Point (lazy-loaded)
 *
 * This component bundles the entire admin panel — route guard, layout, and all
 * sub-routes — into a single code-split chunk.  It is loaded via React.lazy()
 * in App.tsx so that none of the admin UI (sidebar, header, 100+ page modules,
 * recharts, jsPDF, etc.) ends up in the main application bundle.
 */

import { Routes, Route } from 'react-router-dom';
import { AdminRoute } from './AdminRoute';
import { AdminModuleGate } from './AdminModuleGate';
import { AdminLayout } from './AdminLayout';
import { AdminRoutes } from './routes';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';

export default function AdminApp() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route element={<AdminModuleGate />}>
            <Route element={<AdminLayout />}>
              {AdminRoutes()}
            </Route>
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
