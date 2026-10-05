// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useToast: () => toastMock,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useAuth: () => ({ user: { id: 99, name: 'Org Owner' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
  useTenant: () => ({ tenant: { id: 2, currency: 'EUR' }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, hasFeature: () => true, hasModule: () => true }),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import OrgFundraisingTab from './OrgFundraisingTab';
import { api } from '@/lib/api';

const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  title: 'Roof appeal',
  name: 'Roof appeal',
  description: 'A new roof for the hall',
  start_date: '2026-10-01',
  end_date: '2026-12-31',
  goal_amount: '2500.00',
  target_amount: 2500,
  raised_amount: 600,
  donor_count: 4,
  is_active: true,
  status: 'active',
  organization_id: 7,
  ...overrides,
});

const base = '/v2/volunteering/organisations/7';

function routeGets(campaigns: unknown[]) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === `${base}/campaigns`) return { success: true, data: { items: campaigns } };
    if (url.endsWith('/gifts')) {
      return { success: true, data: { items: [
        { id: 1, amount: 20, amount_refunded: 0, currency: 'EUR', status: 'completed', created_at: '2026-10-02 10:00:00', display_name: null, payment_method: 'card' },
        { id: 2, amount: 30, amount_refunded: 0, currency: 'EUR', status: 'pending', created_at: '2026-10-03 10:00:00', display_name: 'Pat Pledger', payment_method: 'pledge' },
      ] } };
    }
    if (url.endsWith('/handovers')) {
      return { success: true, data: {
        items: [{
          id: 5, giving_day_id: 11, organization_id: 7, amount: 100, currency: 'EUR', handed_over_on: '2026-10-04',
          method: 'bank_transfer', reference: 'TRF-1', note: null, status: 'recorded', recorded_by_name: 'Ada Admin',
          created_at: '2026-10-04 09:00:00', confirmed_by_name: null, confirmed_at: null, cancelled_by_name: null,
          cancelled_at: null, cancel_reason: null,
        }],
        summary: { raised: 600, handed_over: 100, still_held: 500, currency: 'EUR' },
      } };
    }
    if (url.endsWith('/history')) {
      return { success: true, data: { items: [{
        id: 1, event: 'campaign_created', actor_kind: 'org_admin', actor_name: 'Org Owner', amount: null, currency: null,
        donation_id: null, handover_id: null, details: null, stripe_object_id: null, created_at: '2026-10-01 08:00:00',
      }] } };
    }
    return { success: false };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeGets([campaign()]);
});

describe('OrgFundraisingTab', () => {
  it('lists the organisation’s campaigns with what they have raised', async () => {
    render(<OrgFundraisingTab orgId={7} />);

    expect(await screen.findByText('Roof appeal')).toBeInTheDocument();
    expect(screen.getByText('€600.00 raised of €2,500.00')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`${base}/campaigns`);
  });

  it('shows an empty state', async () => {
    routeGets([]);
    render(<OrgFundraisingTab orgId={7} />);
    expect(await screen.findByText('Your organisation has no fundraising campaigns yet.')).toBeInTheDocument();
  });

  it('offers a retry when the campaigns cannot load', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false });
    render(<OrgFundraisingTab orgId={7} />);
    expect(await screen.findByText('Could not load your campaigns.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('creates a campaign without ever sending an organisation', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: campaign({ id: 12 }) });
    render(<OrgFundraisingTab orgId={7} />);
    await screen.findByText('Roof appeal');

    fireEvent.click(screen.getByRole('button', { name: 'New campaign' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Van appeal' } });
    fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText(/^End date/), { target: { value: '2026-11-30' } });
    fireEvent.change(within(dialog).getByLabelText(/^Goal/), { target: { value: '800' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save campaign' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(`${base}/campaigns`);
    expect(body).toMatchObject({ title: 'Van appeal', start_date: '2026-11-01', end_date: '2026-11-30', goal_amount: 800 });
    expect(body).not.toHaveProperty('organization_id');
    expect(toastMock.success).toHaveBeenCalledWith('Campaign saved.');
  });

  it('pauses a live campaign', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { success: true } });
    render(<OrgFundraisingTab orgId={7} />);
    await screen.findByText('Roof appeal');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${base}/campaigns/11`, { is_active: false }));
  });

  it('asks before ending a campaign, then ends it today', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { success: true } });
    render(<OrgFundraisingTab orgId={7} />);
    await screen.findByText('Roof appeal');

    fireEvent.click(screen.getByRole('button', { name: 'End campaign' }));
    expect(api.put).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('End this campaign? Members will no longer be able to give to it.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'End campaign' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [, body] = vi.mocked(api.put).mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toMatchObject({ is_active: false });
    expect(body.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows gifts, hand-overs and history, and confirms a hand-over', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 5, status: 'confirmed' } });
    render(<OrgFundraisingTab orgId={7} />);
    await screen.findByText('Roof appeal');

    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));

    expect(await screen.findByText('Anonymous')).toBeInTheDocument();
    expect(screen.getByText('Pat Pledger')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(await screen.findByText('€500.00')).toBeInTheDocument();
    expect(screen.getByText('Campaign created')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${base}/handovers/5/confirm`));
    expect(toastMock.success).toHaveBeenCalledWith('Thank you — receipt confirmed.');
  });
});
