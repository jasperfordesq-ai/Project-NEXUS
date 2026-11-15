// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — every route under `/platform-team`.
 *
 * Called as `{PlatformTeamRoutes()}` inside the guard and the layout
 * (PlatformTeamApp.tsx), the way SuperAdminRoutes is. Everything here is
 * already behind PlatformTeamRoute, so no route needs its own guard.
 *
 * The pages are added in plan Task 7 (moved from `/admin/...`, same address
 * tail) and Task 13 (moved from `/super-admin/...`). Until the panel has a home
 * page (phase 3) the index shows the frame with a short "choose a page" note.
 */

import { Route } from 'react-router-dom';
import { PlatformTeamIndex } from './PlatformTeamIndex';

export function PlatformTeamRoutes() {
  return (
    <>
      <Route index element={<PlatformTeamIndex />} />
      <Route path="*" element={<PlatformTeamIndex notFound />} />
    </>
  );
}

export default PlatformTeamRoutes;
