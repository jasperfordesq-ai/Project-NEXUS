// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { buildLoginTarget, type LoginTarget } from '@/lib/auth-return';

/**
 * Login address that brings the member back to the page they are on (or to
 * `from`) once they have signed in. Use it wherever a page sends a signed-out
 * member to log in — not after a deliberate log-out.
 *
 * Takes the caller's `tenantPath` rather than reading TenantContext itself, so
 * it adds no context import to the start-up bundle and follows whichever
 * context module the caller (and its tests) already use.
 */
export function useLoginRedirect(tenantPath: (path: string) => string): {
  currentPath: string;
  loginTarget: (from?: string) => LoginTarget;
} {
  const location = useLocation();
  const currentPath = useMemo(
    () => tenantPath(location.pathname) + location.search + location.hash,
    [tenantPath, location.pathname, location.search, location.hash],
  );
  const loginTarget = useCallback(
    (from: string = currentPath) => buildLoginTarget(tenantPath('/login'), from),
    [tenantPath, currentPath],
  );
  return { currentPath, loginTarget };
}
