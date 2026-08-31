// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TenantConfig } from '@/lib/api/tenant';

type CapabilitySnapshot = Pick<TenantConfig, 'features' | 'modules'>;
type Requirement = { features?: string[]; modules?: string[] };

let current: CapabilitySnapshot | null = null;

/** Keep provider-resolved tenant capabilities available to non-React tap handlers. */
export function setNavigationTenantCapabilities(value: CapabilitySnapshot | null): void {
  current = value;
}

/**
 * Return true only when the current tenant explicitly disables a requirement.
 * A missing/offline snapshot remains unknown and must not turn a valid deep link
 * into a false negative while the member is offline.
 */
export function isNativeHrefDisabled(href: string): boolean {
  if (!current) return false;
  const requirement = requirementForHref(href);
  if (!requirement) return false;

  return (requirement.features ?? []).some((key) => current?.features[key] === false)
    || (requirement.modules ?? []).some((key) => current?.modules[key] === false);
}

function requirementForHref(href: string): Requirement | null {
  const [path, query = ''] = href.split('?');
  if (/\/feed-item-detail/.test(path)) {
    const type = new URLSearchParams(query).get('type');
    const feature = type === 'poll' ? 'polls' : type === 'resource' ? 'resources' : null;
    return feature ? { features: [feature], modules: ['feed'] } : { modules: ['feed'] };
  }
  if (/\/(?:group-exchange|group-exchanges)/.test(path)) return { features: ['groups', 'group_exchanges'] };
  if (/\/(?:group|groups)/.test(path)) return { features: ['groups'] };
  if (/\/(?:event|events)/.test(path)) return { features: ['events'] };
  if (/\/(?:volunteering|donation)/.test(path)) return { features: ['volunteering'] };
  if (/\/(?:job|jobs|deliverable)/.test(path)) return { features: ['job_vacancies'] };
  if (/\/marketplace/.test(path)) return { features: ['marketplace'] };
  if (/\/federation/.test(path)) return { features: ['federation'] };
  if (/\/(?:connection|connections|network)/.test(path)) return { features: ['connections'] };
  if (/\/course/.test(path)) return { features: ['courses'] };
  if (/\/goal/.test(path)) return { features: ['goals'] };
  if (/\/(?:ideation|new-challenge)/.test(path)) return { features: ['ideation_challenges'] };
  if (/\/poll/.test(path)) return { features: ['polls'] };
  if (/\/review/.test(path)) return { features: ['reviews'] };
  if (/\/resource-detail/.test(path)) return { features: ['resources'] };
  if (/\/blog/.test(path)) return { features: ['blog'] };
  if (/\/(?:achievement|leaderboard|challenge)/.test(path)) return { features: ['gamification'] };
  if (/\/search/.test(path)) return { features: ['search'] };
  if (/\/premium/.test(path)) return { features: ['member_premium'] };
  if (/\/(?:message|thread)/.test(path)) return { features: ['direct_messaging'], modules: ['messages'] };
  if (/\/wallet/.test(path)) return { modules: ['wallet'] };
  if (/\/(?:feed|feed-item)/.test(path)) return { modules: ['feed'] };
  if (/\/(?:exchange-request)/.test(path)) return { features: ['exchange_workflow'], modules: ['listings'] };
  if (/\/(?:exchange|listing)/.test(path)) return { modules: ['listings'] };
  if (/\/(?:member-profile|profile-collection|appreciation)/.test(path)) return { modules: ['profile'] };
  if (/\/settings/.test(path)) return { modules: ['settings'] };
  if (/\/notifications/.test(path)) return { modules: ['notifications'] };
  if (/\/home/.test(path)) return { modules: ['dashboard'] };

  return null;
}
