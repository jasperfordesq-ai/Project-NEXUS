// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E-078: admin addresses that bypassed the page gates. These drive the REAL
 * admin route table, so a route that is re-added without its gate fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div>{message || 'Loading'}</div>,
}));

const tenant = {
  tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
  tenantSlug: 'test',
  hasFeature: () => true,
  hasModule: () => true,
  tenantPath: (path: string) => `/test${path}`,
};

const auth = vi.hoisted(() => ({ user: { id: 1, role: 'admin' } as Record<string, unknown> }));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: auth.user, isAuthenticated: true, isLoading: false, status: 'authenticated' }),
  useTenant: () => tenant,
}));
// Some modules in the route graph import useTenant from the direct path.
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Stand-ins for every page these cases can land on, so nothing fetches.
vi.mock('../modules/groups/GroupList', () => ({ default: () => <div>page:GroupList</div> }));
vi.mock('../modules/groups/GroupTypes', () => ({ default: () => <div>page:GroupTypes</div> }));
vi.mock('../modules/groups/GroupRanking', () => ({ default: () => <div>page:GroupRanking</div> }));
vi.mock('../modules/groups/GroupGeocode', () => ({ default: () => <div>page:GroupGeocode</div> }));
vi.mock('../modules/community/SmartMatchUsers', () => ({ default: () => <div>page:SmartMatchUsers</div> }));
vi.mock('../modules/community/SmartMatchMonitoring', () => ({ default: () => <div>page:SmartMatchMonitoring</div> }));
vi.mock('../modules/matching/MatchingAnalytics', () => ({ default: () => <div>page:MatchingAnalytics</div> }));
vi.mock('../modules/dashboard/AdminDashboard', () => ({ default: () => <div>page:AdminDashboard</div> }));
vi.mock('../modules/system/SeedGenerator', () => ({ default: () => <div>page:SeedGenerator</div> }));
vi.mock('../modules/system/WebpConverter', () => ({ default: () => <div>page:WebpConverter</div> }));
vi.mock('../modules/system/TestRunner', () => ({ default: () => <div>page:TestRunner</div> }));
vi.mock('../modules/system/BlogRestore', () => ({ default: () => <div>page:BlogRestore</div> }));

import { AdminRoutes } from '../routes';

function LocationProbe() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/test/admin/*" element={<><Outlet /><LocationProbe /></>}>
          {AdminRoutes()}
        </Route>
        <Route path="/test/broker/*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { auth.user = { id: 1, role: 'admin' }; });

// F-533: the module gate matches by path prefix, so these hyphenated
// duplicates escaped it. They now redirect to the gated canonical page.
describe('legacy hyphenated admin paths redirect to their gated pages', () => {
  it.each([
    ['group-types', '/test/admin/groups/types'],
    ['group-ranking', '/test/admin/groups/ranking'],
    ['group-locations', '/test/admin/groups'],
    ['geocode-groups', '/test/admin/groups'],
    ['smart-match-users', '/test/broker/match-approvals'],
    ['smart-match-monitoring', '/test/admin/smart-matching/analytics'],
  ])('/admin/%s → %s', async (legacy, target) => {
    renderAt(`/test/admin/${legacy}`);
    expect(await screen.findByLabelText('path')).toHaveTextContent(new RegExp(`^${target}$`));
  });
});

// F-534: platform-maintenance tools had no route guard. They act on, or
// report about, the whole installation, so they are god accounts only — the
// same guard as the other maintenance pages (owner decisions 2026-10-02).
describe('platform-maintenance pages are god accounts only', () => {
  const pages: Array<[string, string]> = [
    ['seed-generator', 'page:SeedGenerator'],
    ['webp-converter', 'page:WebpConverter'],
    ['tests', 'page:TestRunner'],
    ['blog-restore', 'page:BlogRestore'],
  ];

  it.each(pages)('sends a community administrator away from /admin/%s', async (path, page) => {
    renderAt(`/test/admin/${path}`);
    expect(await screen.findByLabelText('path')).toHaveTextContent(/^\/test\/admin$/);
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it.each(pages)('sends a platform super admin who is not a god away from /admin/%s', async (path, page) => {
    auth.user = { id: 1, role: 'admin', is_super_admin: true };
    renderAt(`/test/admin/${path}`);
    expect(await screen.findByLabelText('path')).toHaveTextContent(/^\/test\/admin$/);
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it.each(pages)('opens /admin/%s for a god account', async (path, page) => {
    auth.user = { id: 1, role: 'admin', is_god: true };
    renderAt(`/test/admin/${path}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
  });
});
