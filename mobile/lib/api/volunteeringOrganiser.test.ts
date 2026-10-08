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
  APP_VERSION: '1.0.0',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));
const mockDownload = jest.fn();
jest.mock('@/lib/volunteering/authenticatedFileDownload', () => ({
  downloadAuthenticatedFile: (...args: unknown[]) => mockDownload(...args),
}));

import { api } from '@/lib/api/client';
import {
  campaignStatus,
  confirmHandover,
  createOrganisationCampaign,
  createRecurringPattern,
  createShift,
  deactivateRecurringPattern,
  deleteOpportunity,
  deleteShift,
  downloadOrganisationExpenseReceipt,
  getCampaignGifts,
  getCampaignHandovers,
  getCampaignHistory,
  getManagedShifts,
  getOrganisationCampaigns,
  getOrganisationExpenses,
  getOrganisationOpportunities,
  getRecurringPatterns,
  getShiftCheckIns,
  getShiftRoster,
  isValidDateOnly,
  normaliseClock,
  ORG_EXPENSE_ACTIONS,
  reviewOrganisationExpense,
  shiftTimeToDate,
  splitShiftTime,
  todayDateOnly,
  unwrapList,
  updateOrganisationCampaign,
  updateRecurringPattern,
  updateShift,
} from './volunteeringOrganiser';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.get).mockResolvedValue({ data: {} });
  jest.mocked(api.post).mockResolvedValue({ data: {} });
  jest.mocked(api.put).mockResolvedValue({ data: {} });
  jest.mocked(api.delete).mockResolvedValue(undefined);
});

describe('opportunities', () => {
  it('lists the organisation\'s own opportunities and deletes one by id', async () => {
    await getOrganisationOpportunities(114);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/opportunities');
    await deleteOpportunity(19);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/opportunities/19');
  });
});

describe('shifts', () => {
  it('sends the website\'s exact shift payload on create and update', async () => {
    const payload = { start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: null };
    await createShift(19, payload);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/opportunities/19/shifts', payload);
    await updateShift(44, { ...payload, capacity: 4 });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44', { ...payload, capacity: 4 });
  });

  it('lists, deletes and reads the roster and check-ins of a shift', async () => {
    await getManagedShifts(19);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/opportunities/19/shifts');
    await deleteShift(44);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44');
    await getShiftRoster(44);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44/roster');
    await getShiftCheckIns(44);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/shifts/44/checkins');
  });
});

describe('repeating patterns', () => {
  it('creates with the chosen weekdays, edits by pattern id and deactivates', async () => {
    await getRecurringPatterns(19);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/opportunities/19/recurring-patterns');
    const payload = { frequency: 'weekly' as const, days_of_week: [1, 3], start_time: '09:00:00', end_time: '11:00:00', capacity: 2, start_date: '2099-03-01' };
    await createRecurringPattern(19, payload);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/opportunities/19/recurring-patterns', payload);
    await updateRecurringPattern(7, { days_of_week: [2] });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/recurring-patterns/7', { days_of_week: [2] });
    await deactivateRecurringPattern(7);
    expect(api.delete).toHaveBeenLastCalledWith('/api/v2/volunteering/recurring-patterns/7');
  });
});

describe('expense review', () => {
  it('lists claims with an optional status filter and cursor', async () => {
    await getOrganisationExpenses(114);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses', { per_page: '20' });
    await getOrganisationExpenses(114, 'all');
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses', { per_page: '20' });
    await getOrganisationExpenses(114, 'pending', 'c2');
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses', { per_page: '20', status: 'pending', cursor: 'c2' });
  });

  it('sends the status field the server reads, with notes only when given and a reference only when paying', async () => {
    await reviewOrganisationExpense(114, 5, 'approved');
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses/5', { status: 'approved' });
    await reviewOrganisationExpense(114, 5, 'rejected', { review_notes: '  Missing receipt  ' });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses/5', { status: 'rejected', review_notes: 'Missing receipt' });
    await reviewOrganisationExpense(114, 5, 'approved', { payment_reference: 'ignored-until-paid' });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses/5', { status: 'approved' });
    await reviewOrganisationExpense(114, 5, 'paid', { payment_reference: 'BT-42' });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/expenses/5', { status: 'paid', payment_reference: 'BT-42' });
  });

  it('only offers the next steps the server accepts', () => {
    expect(ORG_EXPENSE_ACTIONS.pending).toEqual(['approved', 'rejected']);
    expect(ORG_EXPENSE_ACTIONS.approved).toEqual(['paid']);
    expect(ORG_EXPENSE_ACTIONS.rejected).toEqual([]);
    expect(ORG_EXPENSE_ACTIONS.paid).toEqual([]);
  });

  it('fetches a receipt with the session headers rather than a bare link', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    await downloadOrganisationExpenseReceipt(114, 5);
    expect(mockDownload).toHaveBeenCalledWith('/api/v2/volunteering/organisations/114/expenses/5/receipt', 'receipt-5', {}, {});
  });
});

describe('fundraising', () => {
  it('scopes every campaign call to the organisation in the URL', async () => {
    await getOrganisationCampaigns(114);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns');
    const body = { title: 'Winter appeal', description: '', start_date: '2099-01-01', end_date: '2099-02-01', goal_amount: 500 };
    await createOrganisationCampaign(114, body);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns', body);
    await updateOrganisationCampaign(114, 9, { is_active: false });
    expect(api.put).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns/9', { is_active: false });
    await getCampaignGifts(114, 9);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns/9/gifts');
    await getCampaignHistory(114, 9);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns/9/history');
    await getCampaignHandovers(114, 9);
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/campaigns/9/handovers');
    await confirmHandover(114, 3);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/volunteering/organisations/114/handovers/3/confirm', {});
  });

  it('reads a campaign\'s state the way the website does', () => {
    expect(campaignStatus({ status: 'paused', is_active: false })).toBe('paused');
    expect(campaignStatus({ status: 'odd', is_active: 1 })).toBe('active');
    expect(campaignStatus({ is_active: 0 })).toBe('ended');
  });
});

describe('unwrapList', () => {
  it('accepts a bare list or a named key, and nothing else', () => {
    expect(unwrapList([1], 'items')).toEqual([1]);
    expect(unwrapList({ items: [2] }, 'items')).toEqual([2]);
    expect(unwrapList({ other: [3] }, 'items')).toEqual([]);
    expect(unwrapList(null, 'items')).toEqual([]);
  });
});

describe('shift time helpers', () => {
  it('reads a stored local time back into the date and clock the form holds', () => {
    expect(splitShiftTime('2099-03-15 09:05:00')).toEqual({ date: '2099-03-15', clock: '09:05' });
    expect(shiftTimeToDate('2099-03-15 09:05:00').getHours()).toBe(9);
  });

  it('only accepts real dates and real clock times', () => {
    expect(isValidDateOnly('2099-02-31')).toBe(false);
    expect(isValidDateOnly('2099-02-28')).toBe(true);
    expect(normaliseClock('9:30')).toBe('09:30');
    expect(normaliseClock('09:30:00')).toBe('09:30');
    expect(normaliseClock('24:00')).toBeNull();
    expect(normaliseClock('nine')).toBeNull();
    expect(todayDateOnly(new Date(2099, 0, 5))).toBe('2099-01-05');
  });
});
