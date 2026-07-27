// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { adminFederation } from '@/admin/api/adminApi';

/**
 * Effective external partner federation posture, for the Partner Timebanks panel.
 *
 * Read from `/v2/admin/federation/settings` rather than the super-admin
 * external-status endpoint: this panel is reachable by tenant super admins,
 * who are excluded from the platform-super-admin routes.
 */
export interface ExternalFederationStatus {
  effective: boolean;
  masterEnabled: boolean;
  emergencyLockdown: boolean;
  reason: string | null;
  protocols: Record<string, boolean>;
}

interface RawStatus {
  effective?: boolean;
  master_enabled?: boolean;
  emergency_lockdown_active?: boolean;
  reason?: string | null;
  protocols?: Record<string, boolean>;
}

/**
 * One in-flight request shared by every consumer. The banner and both sidebar
 * instances (desktop + mobile drawer) mount together, and this is a slow-moving
 * platform setting — refetching it three times per navigation is pure noise.
 */
let cached: Promise<ExternalFederationStatus | null> | null = null;

function fetchStatus(): Promise<ExternalFederationStatus | null> {
  cached ??= adminFederation
    .getSettings()
    .then((res) => {
      const raw = (res?.data as { external_federation?: RawStatus } | undefined)?.external_federation;
      if (!raw) return null;
      return {
        effective: Boolean(raw.effective),
        masterEnabled: Boolean(raw.master_enabled),
        emergencyLockdown: Boolean(raw.emergency_lockdown_active),
        reason: raw.reason ?? null,
        protocols: raw.protocols ?? {},
      };
    })
    .catch(() => null);

  return cached;
}

/** Testing/navigation escape hatch — drops the shared cache. */
export function resetExternalFederationStatusCache(): void {
  cached = null;
}

export function useExternalFederationStatus(): ExternalFederationStatus | null {
  const [status, setStatus] = useState<ExternalFederationStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetchStatus().then((s) => {
      if (active) setStatus(s);
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
