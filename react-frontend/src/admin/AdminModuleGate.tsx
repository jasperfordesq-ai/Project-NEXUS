// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTenant } from '@/contexts';
import type { TenantFeatures, TenantModules } from '@/types/api';

/** Operational pages mirror the sidebar gates; setup and recovery stay reachable. */
export const ADMIN_MODULE_REQUIREMENTS: ReadonlyArray<{
  path: string; feature?: keyof TenantFeatures; module?: keyof TenantModules;
}> = [
  { path: 'ai/ki-agents', feature: 'ai_agents' },
  { path: 'marketplace/coupons', feature: 'merchant_coupons' },
  { path: 'listings', module: 'listings' },
  { path: 'timebanking', module: 'wallet' },
  { path: 'blog', feature: 'blog' },
  { path: 'resources', feature: 'resources' },
  { path: 'groups', feature: 'groups' },
  { path: 'events', feature: 'events' },
  { path: 'polls', feature: 'polls' },
  { path: 'goals', feature: 'goals' },
  { path: 'podcasts', feature: 'podcasts' },
  { path: 'courses', feature: 'courses' },
  { path: 'ideation', feature: 'ideation_challenges' },
  { path: 'volunteering', feature: 'volunteering' },
  { path: 'partner-venues', feature: 'partner_venues' },
  { path: 'gamification', feature: 'gamification' },
  { path: 'custom-badges', feature: 'gamification' },
  { path: 'smart-matching', feature: 'exchange_workflow' },
  { path: 'marketplace', feature: 'marketplace' },
  { path: 'newsletters', feature: 'newsletter' },
  { path: 'advertising', feature: 'local_advertising' },
  { path: 'ai', feature: 'ai_chat' },
  { path: 'ai-settings', feature: 'ai_chat' },
];

export function AdminModuleGate() {
  const { pathname } = useLocation();
  const { hasFeature, hasModule, isLoading, tenantPath } = useTenant();
  const root = tenantPath('/admin');
  const path = pathname.startsWith(`${root}/`) ? pathname.slice(root.length + 1) : '';
  const requirement = ADMIN_MODULE_REQUIREMENTS.find(r => path === r.path || path.startsWith(`${r.path}/`));
  if (isLoading) return null;
  if (requirement && ((requirement.feature && !hasFeature(requirement.feature))
    || (requirement.module && !hasModule(requirement.module)))) {
    return <Navigate to={tenantPath('/admin/not-found')} replace />;
  }
  return <Outlet />;
}
