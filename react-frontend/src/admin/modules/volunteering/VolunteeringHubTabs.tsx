// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The tab strip that turns several former sidebar pages into one sidebar
 * entry (2026-10-18): Opportunities & shifts, Training & certificates and
 * Fundraising & donations. Each tab is its own address, so bookmarks,
 * breadcrumbs and sidebar search still land on the right thing; the pages
 * themselves render unchanged through the router outlet below the strip.
 *
 * A tab that only ever has content when a community setting is on (Swap
 * requests, Group bookings) is simply not offered while that setting is off,
 * instead of leading to a page that is always empty.
 */

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tab, Tabs } from '@/components/ui';
import { useTenant } from '@/contexts';

export interface HubTab {
  key: string;
  /** Admin path without the community prefix, e.g. `/admin/volunteering/records/training`. */
  href: string;
  label: string;
  /** Leave undefined for "always"; false hides the tab. */
  visible?: boolean;
}

interface VolunteeringHubTabsProps {
  ariaLabel: string;
  tabs: HubTab[];
}

export function VolunteeringHubTabs({ ariaLabel, tabs }: VolunteeringHubTabsProps) {
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const visible = tabs.filter((tab) => tab.visible !== false);
  // Longest match first: `/opportunities/swaps` must beat `/opportunities`.
  // The location is compared in both forms: in a community addressed by slug
  // the admin routes run under TenantShell's nested <Routes location> whose
  // pathname has the slug already stripped, so it never equals tenantPath().
  const isOn = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const current = [...visible]
    .sort((a, b) => b.href.length - a.href.length)
    .find((tab) => isOn(tab.href) || isOn(tenantPath(tab.href)));
  const selectedKey = current?.key ?? visible[0]?.key;

  return (
    <div className="space-y-6">
      {visible.length > 1 && (
        <Tabs
          aria-label={ariaLabel}
          selectedKey={selectedKey}
          onSelectionChange={(key) => {
            const target = visible.find((tab) => tab.key === String(key));
            if (target && target.key !== selectedKey) navigate(tenantPath(target.href));
          }}
          variant="underlined"
        >
          {visible.map((tab) => (
            <Tab key={tab.key} title={tab.label} />
          ))}
        </Tabs>
      )}
      <Outlet />
    </div>
  );
}

export default VolunteeringHubTabs;
