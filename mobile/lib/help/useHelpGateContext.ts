// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What the members' guide needs to know to hide topics this community has
 * switched off: tenant features and modules, plus the Broker Panel's exchange
 * workflow switch (whether members can request exchanges at all), which is not
 * a feature and has to be fetched. Until it loads, or if it cannot be loaded,
 * the setting counts as on, so the exchange guides are shown rather than lost.
 */

import { useEffect, useMemo, useState } from 'react';

import { getExchangeWorkflowConfig } from '@/lib/api/exchanges';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import type { HelpGateContext } from './guides';

export function useHelpGateContext(): HelpGateContext {
  const { hasFeature, hasModule, tenantSlug } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const [exchangeWorkflow, setExchangeWorkflow] = useState<boolean | null>(null);
  const memberKey = isAuthenticated ? `${tenantSlug}:${user?.id ?? ''}` : null;

  useEffect(() => {
    // Never carry one member/community's broker setting into another context
    // while the authoritative value is loading.
    setExchangeWorkflow(null);
    if (!memberKey) return;
    let cancelled = false;
    getExchangeWorkflowConfig()
      .then((response) => {
        const config = response && 'data' in response ? response.data : response;
        if (!cancelled && typeof config?.exchange_workflow_enabled === 'boolean') {
          setExchangeWorkflow(config.exchange_workflow_enabled);
        }
      })
      .catch(() => {
        // Unknown stays "on": a guide shown by mistake is better than one lost.
      });
    return () => {
      cancelled = true;
    };
  }, [memberKey]);

  return useMemo<HelpGateContext>(() => ({
    hasFeature,
    hasModule,
    hasSetting: (name) => (name === 'exchange_workflow' ? exchangeWorkflow ?? true : true),
  }), [hasFeature, hasModule, exchangeWorkflow]);
}
