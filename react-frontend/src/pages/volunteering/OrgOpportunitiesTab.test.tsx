// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OrgOpportunitiesTab — an organisation's own opportunities on its dashboard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(',')}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Default contexts: tenantPath(p) is "/test" + p.
vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { OrgOpportunitiesTab, type OrgOpportunity } from './OrgOpportunitiesTab';
import { api } from '@/lib/api';

const base = { location: 'Town hall', is_remote: false, start_date: '2026-11-01', end_date: null, pending_applications: 0, approved_volunteers: 0, upcoming_shifts: 0 };
const items: OrgOpportunity[] = [
  { ...base, id: 1, title: 'Garden tidy-up', state: 'open', pending_applications: 2, approved_volunteers: 3, upcoming_shifts: 4 },
  { ...base, id: 2, title: 'Food bank sorting', state: 'open' },
  { ...base, id: 3, title: 'Summer fair', state: 'closed' },
  { ...base, id: 4, title: 'Old project', state: 'cancelled' },
];

describe('OrgOpportunitiesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the open opportunities first, with what needs attention and counts per filter', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items } });
    render(<OrgOpportunitiesTab orgId={7} />);

    expect(await screen.findByTestId('org-opp-1')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/7/opportunities');
    expect(screen.getByTestId('org-opp-2')).toBeInTheDocument();
    expect(screen.queryByTestId('org-opp-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('org-opp-1')).toHaveTextContent('org_dashboard.opps_pending:count=2');
    expect(screen.getByTestId('org-opp-1')).toHaveTextContent('org_dashboard.opps_upcoming_shifts:count=4');
    expect(screen.getByTestId('org-opps-filter-open')).toHaveTextContent('org_dashboard.opps_filter_open:count=2');
    expect(screen.getByTestId('org-opps-filter-closed')).toHaveTextContent('org_dashboard.opps_filter_closed:count=1');
    expect(screen.getByTestId('org-opp-manage-1')).toHaveAttribute('href', '/test/volunteering/opportunities/1');
  });

  it('shows closed and cancelled ones on their filters; a cancelled one cannot be edited', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items } });
    render(<OrgOpportunitiesTab orgId={7} />);
    await screen.findByTestId('org-opp-1');

    fireEvent.click(screen.getByTestId('org-opps-filter-closed'));
    expect(screen.getByTestId('org-opp-3')).toHaveTextContent('org_dashboard.opps_state_closed');
    expect(screen.queryByTestId('org-opp-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('org-opps-filter-cancelled'));
    expect(screen.getByTestId('org-opp-4')).toHaveTextContent('org_dashboard.opps_state_cancelled');
    expect(screen.getByTestId('org-opp-4')).not.toHaveTextContent('org_dashboard.opps_edit');

    fireEvent.click(screen.getByTestId('org-opps-filter-all'));
    expect(screen.getAllByTestId(/^org-opp-\d+$/)).toHaveLength(4);
  });

  it('says so when there is nothing open', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [] } });
    render(<OrgOpportunitiesTab orgId={7} />);

    expect(await screen.findByTestId('org-opps-empty')).toHaveTextContent('org_dashboard.opps_empty_open');
  });

  it('offers a retry when the list cannot load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'boom' });
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { items } });
    render(<OrgOpportunitiesTab orgId={7} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('org_dashboard.opps_load_error');
    fireEvent.click(screen.getByRole('button', { name: /org_dashboard\.opps_retry/ }));
    await waitFor(() => expect(screen.getByTestId('org-opp-1')).toBeInTheDocument());
  });
});
