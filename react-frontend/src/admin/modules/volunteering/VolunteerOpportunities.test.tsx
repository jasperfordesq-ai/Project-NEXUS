// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockGetOpportunities = vi.hoisted(() => vi.fn());
vi.mock('../../api/adminApi', () => ({
  adminVolunteering: {
    getOpportunities: mockGetOpportunities,
  },
}));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// The shift panel has its own tests; here it only needs to appear for the right opportunity.
vi.mock('@/components/volunteering/ShiftManager', () => ({
  ShiftManager: ({ opportunityId }: { opportunityId: number }) => (
    <div data-testid="shift-manager-stub">opportunity {opportunityId}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { VolunteerOpportunities } from './VolunteerOpportunities';

const rows = [
  { id: 11, title: 'Community Gardening', status: 'open', is_active: 1, organization_id: 3, org_name: 'Green Dublin', org_status: 'approved', category_name: null, start_date: null, end_date: null, created_at: '2026-09-01 10:00:00' },
  { id: 12, title: 'Meals on Wheels', status: 'closed', is_active: 0, organization_id: 4, org_name: 'Food For All', org_status: 'approved', category_name: null, start_date: null, end_date: null, created_at: '2026-08-01 10:00:00' },
];

describe('VolunteerOpportunities (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOpportunities.mockResolvedValue({ success: true, data: rows, meta: { cursor: null, has_more: false } });
  });

  it('lists every opportunity with its organisation and status', async () => {
    render(<VolunteerOpportunities />);
    expect(await screen.findByText('Community Gardening')).toBeInTheDocument();
    expect(screen.getByText('Green Dublin')).toBeInTheDocument();
    expect(screen.getByText('volunteering.opportunity_status_open')).toBeInTheDocument();
    expect(screen.getByText('volunteering.opportunity_status_closed')).toBeInTheDocument();
    expect(mockGetOpportunities).toHaveBeenCalledWith({ search: '', cursor: null });
  });

  it('opens the shift panel for one opportunity at a time', async () => {
    render(<VolunteerOpportunities />);
    await screen.findByText('Community Gardening');
    expect(screen.queryByTestId('shift-manager-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('admin-opportunity-toggle-11'));
    expect(screen.getByTestId('shift-manager-stub')).toHaveTextContent('opportunity 11');

    fireEvent.click(screen.getByTestId('admin-opportunity-toggle-12'));
    expect(screen.getAllByTestId('shift-manager-stub')).toHaveLength(1);
    expect(screen.getByTestId('shift-manager-stub')).toHaveTextContent('opportunity 12');

    fireEvent.click(screen.getByTestId('admin-opportunity-toggle-12'));
    expect(screen.queryByTestId('shift-manager-stub')).not.toBeInTheDocument();
  });

  it('searches when the search form is submitted', async () => {
    render(<VolunteerOpportunities />);
    await screen.findByText('Community Gardening');

    fireEvent.change(screen.getByTestId('admin-opportunities-search'), { target: { value: 'meals' } });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => {
      expect(mockGetOpportunities).toHaveBeenLastCalledWith({ search: 'meals', cursor: null });
    });
  });

  it('shows the empty state when there are no opportunities', async () => {
    mockGetOpportunities.mockResolvedValue({ success: true, data: [], meta: { cursor: null, has_more: false } });
    render(<VolunteerOpportunities />);
    expect(await screen.findByText('volunteering.no_opportunities')).toBeInTheDocument();
  });
});
