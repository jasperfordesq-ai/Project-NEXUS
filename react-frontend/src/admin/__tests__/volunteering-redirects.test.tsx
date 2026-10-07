// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gap D8 (7 Oct 2026): the obvious name for a volunteering admin page that
 * lives under another address used to end on "page not found". These run the
 * real admin route table, so a redirect deleted from it fails here.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div>{message || 'Loading'}</div>,
}));

const tenant = () => ({
  tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
  tenantSlug: 'test',
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  tenantPath: (path: string) => `/test${path}`,
});

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'admin', is_admin: true },
    isAuthenticated: true,
    isLoading: false,
    status: 'authenticated',
  })),
  useTenant: vi.fn(() => tenant()),
}));

// Some admin modules import useTenant from the context file directly.
vi.mock('@/contexts/TenantContext', () => ({ useTenant: vi.fn(() => tenant()) }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// The destinations themselves are not under test; stand-ins keep this fast.
vi.mock('../modules/volunteering/VolunteeringOverview', () => ({ default: () => <div>Overview page</div> }));
vi.mock('../modules/volunteering/VolunteerApprovals', () => ({ default: () => <div>Approvals page</div> }));
vi.mock('../modules/volunteering/VolunteerSwaps', () => ({ default: () => <div>Swaps page</div> }));
vi.mock('../modules/volunteering/VolunteerOpportunities', () => ({ default: () => <div>Opportunities page</div> }));
vi.mock('../modules/volunteering/VolunteerOrganizations', () => ({ default: () => <div>Organisations page</div> }));
vi.mock('../modules/volunteering/VolunteerSafeguarding', () => ({ default: () => <div>Safeguarding page</div> }));
vi.mock('../modules/volunteering/incidents/VolunteerIncidentCase', () => ({ default: () => <div>Incident page</div> }));
vi.mock('../modules/volunteering/VolunteerGivingDays', () => ({ default: () => <div>Giving days page</div> }));
vi.mock('../modules/volunteering/VolunteerConfig', () => ({ default: () => <div>Config page</div> }));
vi.mock('../modules/AdminNotFound', () => ({ default: () => <div>Admin Not Found</div> }));

import { AdminRoutes } from '../routes';

function LocationProbe() {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/test/admin/*" element={<Outlet />}>
          {AdminRoutes()}
        </Route>
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('guessed volunteering admin addresses', () => {
  it.each([
    ['applications', '/test/admin/volunteering/approvals', 'Approvals page'],
    ['incidents', '/test/admin/volunteering/safeguarding', 'Safeguarding page'],
    ['settings', '/test/admin/volunteering/config', 'Config page'],
    ['organisations', '/test/admin/volunteering/organizations', 'Organisations page'],
    ['fundraising', '/test/admin/volunteering/giving-days', 'Giving days page'],
    ['shift-swaps', '/test/admin/volunteering/swaps', 'Swaps page'],
    ['shifts', '/test/admin/volunteering/opportunities', 'Opportunities page'],
    ['wellbeing', '/test/admin/volunteering', 'Overview page'],
  ])('/admin/volunteering/%s lands on the real page', async (guess, target, page) => {
    renderAt(`/test/admin/volunteering/${guess}`);

    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(screen.getByLabelText('path')).toHaveTextContent(target);
    expect(screen.queryByText('Admin Not Found')).not.toBeInTheDocument();
  });

  it('keeps the case number when an incident address is guessed', async () => {
    renderAt('/test/admin/volunteering/incidents/42');

    expect(await screen.findByText('Incident page')).toBeInTheDocument();
    expect(screen.getByLabelText('path')).toHaveTextContent('/test/admin/volunteering/safeguarding/42');
  });
});
