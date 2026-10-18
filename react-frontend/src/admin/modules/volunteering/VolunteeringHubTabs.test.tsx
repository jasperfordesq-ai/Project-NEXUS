// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

const { tenantState } = vi.hoisted(() => ({
  tenantState: { volunteeringConfig: {} as Record<string, unknown> },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    volunteeringConfig: tenantState.volunteeringConfig,
  }),
}));

// HeroUI Tabs render fine in jsdom but their selection plumbing is not under
// test here; a plain tablist keeps the assertions about hrefs and visibility honest.
vi.mock('@/components/ui', () => ({
  Tabs: ({ children, selectedKey, onSelectionChange, 'aria-label': ariaLabel }: {
    children: React.ReactNode; selectedKey?: string; onSelectionChange?: (key: string) => void; 'aria-label'?: string;
  }) => (
    <div role="tablist" aria-label={ariaLabel} data-selected={selectedKey}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<{ title: React.ReactNode }>(child)) return null;
        const key = String(child.key).replace(/^\.\$/, '');
        return (
          <button role="tab" aria-selected={key === selectedKey} onClick={() => onSelectionChange?.(key)}>
            {child.props.title}
          </button>
        );
      })}
    </div>
  ),
  Tab: () => null,
}));

import { VolunteeringHubTabs } from './VolunteeringHubTabs';
import OpportunitiesHub from './OpportunitiesHub';
import RecordsHub from './RecordsHub';
import FundraisingHub from './FundraisingHub';

function renderHub(path: string, hub: React.ReactElement, child = <div>Tab body</div>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/test/admin/volunteering/*" element={hub}>
          <Route path="*" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('VolunteeringHubTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.volunteeringConfig = {};
  });

  it('selects the tab whose address the page is on, longest match first', () => {
    render(
      <MemoryRouter initialEntries={['/test/admin/volunteering/opportunities/swaps']}>
        <Routes>
          <Route
            path="/test/admin/volunteering/*"
            element={
              <VolunteeringHubTabs
                ariaLabel="Opportunities"
                tabs={[
                  { key: 'opportunities', href: '/admin/volunteering/opportunities', label: 'Opportunities' },
                  { key: 'swaps', href: '/admin/volunteering/opportunities/swaps', label: 'Swap requests' },
                ]}
              />
            }
          >
            <Route path="*" element={<div>Tab body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('tab', { name: 'Swap requests' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Opportunities' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Tab body')).toBeInTheDocument();
  });

  it('navigates to the chosen tab within the community', async () => {
    renderHub('/test/admin/volunteering/records/training', <RecordsHub />);

    await userEvent.click(screen.getByRole('tab', { name: 'Certificates' }));

    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/volunteering/records/certificates');
  });

  it('shows no tab strip when only one tab is visible', () => {
    renderHub('/test/admin/volunteering/opportunities', <OpportunitiesHub />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Tab body')).toBeInTheDocument();
  });
});

describe('OpportunitiesHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.volunteeringConfig = {};
  });

  it('offers Swap requests only when the community needs admin approval for swaps', () => {
    tenantState.volunteeringConfig = { 'volunteering.swap_requires_admin': true };
    renderHub('/test/admin/volunteering/opportunities', <OpportunitiesHub />);

    expect(screen.getByRole('tab', { name: 'Swap requests' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Group bookings' })).not.toBeInTheDocument();
  });

  it('offers Group bookings only when the group sign-ups tab is switched on', () => {
    tenantState.volunteeringConfig = { 'volunteering.tab_group_signups': true };
    renderHub('/test/admin/volunteering/opportunities', <OpportunitiesHub />);

    expect(screen.getByRole('tab', { name: 'Group bookings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Swap requests' })).not.toBeInTheDocument();
  });
});

describe('RecordsHub and FundraisingHub', () => {
  it('lists Training, Qualifications and Certificates', () => {
    renderHub('/test/admin/volunteering/records/training', <RecordsHub />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Training', 'Qualifications', 'Certificates']);
  });

  it('lists Campaigns and Donations', () => {
    renderHub('/test/admin/volunteering/fundraising/campaigns', <FundraisingHub />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Campaigns', 'Donations']);
  });
});
