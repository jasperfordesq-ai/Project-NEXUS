// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import {
  cancelShiftSignup,
  cancelShiftSwap,
  expressInterest,
  generateVolunteerCertificate,
  getShiftSwaps,
  getMyShifts,
  getOpportunities,
  getOpportunity,
  getVolunteerCertificates,
  getVolunteerExpenses,
  getVolunteerDonations,
  getVolunteerGivingDays,
  getOrganisation,
  getOrganisationApplications,
  getOrganisationPendingHours,
  getOrganisationStats,
  getOrganisationVolunteers,
  getOrganisationWalletTransactions,
  submitVolunteerExpense,
  submitVolunteerDonation,
  respondToShiftSwap,
  depositOrganisationWallet,
  updateOrganisation,
  verifyVolunteerHours,
} from './volunteering';
import type { VolunteeringResponse, VolunteerOpportunity } from './volunteering';

const mockOpportunity: VolunteerOpportunity = {
  id: 3,
  title: 'Community Garden Helper',
  description: 'Help maintain the community garden.',
  /*
    🔴 The server sends `organization` (US spelling) — measured 2026-08-24. The British
    spelling stays optional, and both are set here because every screen reads
    `organisation ?? organization` and either can arrive.
  */
  organization: { id: 2, name: 'Green Spaces Co-op', avatar: null },
  organisation: { id: 2, name: 'Green Spaces Co-op', avatar: null },
  location: 'Dublin',
  is_remote: false,
  hours_per_week: 3,
  commitment: 'Weekly',
  skills_needed: ['gardening'],
  status: 'open',
  spots_available: 5,
  deadline: '2026-04-30T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z',
};

const mockVolunteeringResponse: VolunteeringResponse = {
  data: [mockOpportunity],
  meta: { has_more: false, cursor: null },
};

describe('getOpportunities', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no params on first page', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    const result = await getOpportunities(null);
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/opportunities', {});
    expect(result.data).toHaveLength(1);
    expect(result.meta.has_more).toBe(false);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    await getOpportunities('cursor-vol-1');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/opportunities', { cursor: 'cursor-vol-1' });
  });

  it('omits cursor when null', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    await getOpportunities(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('cursor');
  });

  it('includes search param when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    await getOpportunities(null, 'gardening');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/opportunities', { search: 'gardening' });
  });

  it('omits search when not provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    await getOpportunities(null);
    const call = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(call).not.toHaveProperty('search');
  });

  it('includes cursor and search together', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockVolunteeringResponse);
    await getOpportunities('cursor-2', 'teaching');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/opportunities', {
      cursor: 'cursor-2',
      search: 'teaching',
    });
  });
});

describe('getOpportunity', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with the opportunity ID', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockOpportunity });
    const result = await getOpportunity(3);
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/opportunities/3');
    expect(result.data.title).toBe('Community Garden Helper');
    expect(result.data.status).toBe('open');
  });
});

describe('expressInterest', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('sends POST to the correct interest endpoint with empty body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ message: 'Interest registered' });
    const result = await expressInterest(3);
    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/opportunities/3/apply', {});
    expect(result.message).toBe('Interest registered');
  });
});

describe('shift helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads the authenticated volunteer shift schedule', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getMyShifts();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/shifts', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('cancels a shift signup', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);
    await cancelShiftSignup(42);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/volunteering/shifts/42/signup');
  });
});

describe('shift swap helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads shift swaps without a direction filter by default', async () => {
    const response = { data: { swaps: [] } };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getShiftSwaps();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/swaps', {});
    expect(result.data).toEqual({ swaps: [] });
  });

  it('loads shift swaps with a direction filter', async () => {
    const response = { data: { swaps: [] } };
    (api.get as jest.Mock).mockResolvedValue(response);
    await getShiftSwaps('received');
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/swaps', { direction: 'received' });
  });

  it('responds to a shift swap', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 3, status: 'accepted' } });
    await respondToShiftSwap(3, 'accept');
    expect(api.put).toHaveBeenCalledWith('/api/v2/volunteering/swaps/3', { action: 'accept' });
  });

  it('cancels a shift swap', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);
    await cancelShiftSwap(3);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/volunteering/swaps/3');
  });
});

describe('certificate helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads volunteer certificates', async () => {
    const response = { data: { items: [], cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getVolunteerCertificates();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/certificates', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('generates a volunteer certificate', async () => {
    const response = { data: { id: 9, verification_code: 'ABC123' } };
    (api.post as jest.Mock).mockResolvedValue(response);
    const result = await generateVolunteerCertificate();
    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/certificates', {});
    expect(result.data.verification_code).toBe('ABC123');
  });
});

describe('expense helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads volunteer expenses', async () => {
    const response = { data: { expenses: [], items: [], stats: {}, cursor: null, has_more: false } };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getVolunteerExpenses();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/expenses', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('submits a volunteer expense payload', async () => {
    const payload = {
      organization_id: 5,
      expense_type: 'travel' as const,
      amount: 12.5,
      currency: 'EUR',
      description: 'Bus ticket',
    };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 3 } });
    await submitVolunteerExpense(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/expenses', payload);
  });
});

describe('donation helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads active volunteer giving days', async () => {
    const response = { data: [] };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getVolunteerGivingDays();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/giving-days', {});
    expect(result.data).toEqual([]);
  });

  it('loads volunteer donations', async () => {
    const response = { data: { items: [], next_cursor: null } };
    (api.get as jest.Mock).mockResolvedValue(response);
    const result = await getVolunteerDonations();
    expect(api.get).toHaveBeenCalledWith('/api/v2/volunteering/donations', { per_page: '20' });
    expect(result.data.items).toEqual([]);
  });

  it('submits a volunteer donation payload', async () => {
    const payload = {
      giving_day_id: 8,
      amount: 25,
      currency: 'EUR',
      payment_method: 'bank_transfer',
      message: 'For the campaign',
      is_anonymous: true,
    };
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 4 } });
    await submitVolunteerDonation(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/donations', payload);
  });
});

describe('organisation dashboard helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads managed organisation details and stats', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 9, name: 'Garden Team' } })
      .mockResolvedValueOnce({ data: { total_volunteers: 2, wallet_balance: 5 } });

    await getOrganisation(9);
    await getOrganisationStats(9);

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/volunteering/organisations/9');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/volunteering/organisations/9/stats');
  });

  it('loads organisation review queues and volunteers', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { items: [], cursor: null, has_more: false } });

    await getOrganisationApplications(9, 'pending');
    await getOrganisationPendingHours(9);
    await getOrganisationVolunteers(9);
    await getOrganisationWalletTransactions(9);

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/volunteering/organisations/9/applications', { per_page: '20', status: 'pending' });
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/volunteering/organisations/9/hours/pending', { per_page: '20' });
    expect(api.get).toHaveBeenNthCalledWith(3, '/api/v2/volunteering/organisations/9/volunteers', { per_page: '20' });
    expect(api.get).toHaveBeenNthCalledWith(4, '/api/v2/volunteering/organisations/9/wallet/transactions', { per_page: '20' });
  });

  it('updates organisation dashboard actions', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: {} });
    (api.post as jest.Mock).mockResolvedValue({ data: { new_balance: 8 } });

    await verifyVolunteerHours(4, 'approve');
    // 🔴 `setOrganisationAutoPay` was removed on 2026-08-21. It called an endpoint
    // Laravel never registered (measured: HTTP 404) and governed nothing — approval
    // always mints credits. React had already removed the same control. This test used
    // to assert the broken call as the SECOND api.put, which is why the numbering below
    // shifts down by one.
    await updateOrganisation(9, { name: 'Garden Team' });
    await depositOrganisationWallet(9, 3, 'Top-up');

    expect(api.put).toHaveBeenNthCalledWith(1, '/api/v2/volunteering/hours/4/verify', { action: 'approve' });
    expect(api.put).toHaveBeenNthCalledWith(2, '/api/v2/volunteering/organisations/9', { name: 'Garden Team' });
    expect(api.post).toHaveBeenCalledWith('/api/v2/volunteering/organisations/9/wallet/deposit', { amount: 3, note: 'Top-up' });
  });
});
