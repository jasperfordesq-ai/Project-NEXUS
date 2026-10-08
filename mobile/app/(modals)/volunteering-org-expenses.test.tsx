// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockRouteParams: Record<string, string> = { id: '114' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'expenses.title': 'Expense claims',
        'expenses.intro': 'Expense claims your volunteers have submitted.',
        'expenses.filterLabel': 'Filter claims by status',
        'expenses.filter.all': 'All',
        'expenses.filter.pending': 'Pending',
        'expenses.filter.approved': 'Approved',
        'expenses.filter.rejected': 'Rejected',
        'expenses.filter.paid': 'Paid',
        'expenses.stats.total': 'Total claimed',
        'expenses.stats.pending': 'Waiting for review',
        'expenses.stats.approved': 'Approved (including paid)',
        'expenses.stats.paid': 'Paid',
        'expenses.loadError': 'Could not load the expense claims.',
        'expenses.notYoursTitle': 'You do not manage this organisation',
        'expenses.notYoursHint': 'Only its owners and admins can review expense claims.',
        'expenses.emptyTitle': 'No expense claims here',
        'expenses.emptyPending': 'There are no claims waiting for review.',
        'expenses.emptyOther': 'No claims match this filter.',
        'expenses.submittedOn': `Submitted ${String(o.date ?? '')}`,
        'expenses.notePrefix': `Note: ${String(o.note ?? '')}`,
        'expenses.paymentReference': `Payment reference: ${String(o.reference ?? '')}`,
        'expenses.ownClaim': 'This is your own claim. Another organisation admin must review it.',
        'expenses.receipt': 'Receipt',
        'expenses.receiptLabel': `Open the receipt for the claim from ${String(o.name ?? '')}`,
        'expenses.receiptFailed': 'Could not open the receipt.',
        'expenses.receiptSharingUnavailable': 'Nothing on this device can open the receipt.',
        'expenses.approve': 'Approve',
        'expenses.approveLabel': `Approve the claim from ${String(o.name ?? '')}`,
        'expenses.reject': 'Reject',
        'expenses.rejectLabel': `Reject the claim from ${String(o.name ?? '')}`,
        'expenses.markPaid': 'Mark as paid',
        'expenses.markPaidLabel': `Mark the claim from ${String(o.name ?? '')} as paid`,
        'expenses.rejectNotesLabel': 'Reason (optional)',
        'expenses.rejectNotesPlaceholder': 'Tell the volunteer why',
        'expenses.rejectConfirm': 'Reject claim',
        'expenses.paidIntro': 'Only do this once the money has reached the volunteer.',
        'expenses.paymentReferenceLabel': 'Payment reference (optional)',
        'expenses.paymentReferencePlaceholder': 'For example, a bank transfer reference',
        'expenses.paidConfirm': 'Confirm paid',
        'expenses.approvedToast': 'Expense claim approved.',
        'expenses.rejectedToast': 'Expense claim rejected.',
        'expenses.paidToast': 'Expense claim marked as paid.',
        'expenses.alreadyHandled': 'This claim has already been dealt with by someone else.',
        'expenses.actionError': 'Could not update this claim.',
        'expenses.loadMore': 'Load more',
        'volunteering:expenses.types.travel': 'Travel',
        'common:back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:errors.notFound': 'Not found.',
        'common:errors.refreshFailedTitle': 'Couldn’t refresh',
        'common:errors.refreshFailedSubtitle': 'You’re still seeing what loaded earlier.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', errorBg: '#fee2e2', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({ usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args) }));
jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return { ...actual, getOrganisationExpenses: jest.fn(), reviewOrganisationExpense: jest.fn(), downloadOrganisationExpenseReceipt: jest.fn() };
});

import { downloadOrganisationExpenseReceipt, reviewOrganisationExpense } from '@/lib/api/volunteeringOrganiser';
import OrgExpenses from './volunteering-org-expenses';

const CLAIMS = [
  { id: 1, user_id: 9, volunteer_name: 'Alex Volunteer', avatar_url: null, organization_id: 114, opportunity_id: null, expense_type: 'travel', amount: '12.50', currency: 'EUR', description: 'Bus to the allotment', status: 'pending', has_receipt: true, submitted_at: '2026-05-01 10:00:00', reviewed_by: null, reviewed_at: null, review_notes: null, paid_at: null, payment_reference: null },
  { id: 2, user_id: 7, volunteer_name: 'Me Myself', avatar_url: null, organization_id: 114, opportunity_id: null, expense_type: 'travel', amount: 4, currency: 'EUR', description: null, status: 'pending', has_receipt: false, submitted_at: '2026-05-02 10:00:00', reviewed_by: null, reviewed_at: null, review_notes: null, paid_at: null, payment_reference: null },
  { id: 3, user_id: 10, volunteer_name: 'Bea Helper', avatar_url: null, organization_id: 114, opportunity_id: null, expense_type: 'travel', amount: 20, currency: 'EUR', description: null, status: 'approved', has_receipt: false, submitted_at: '2026-05-03 10:00:00', reviewed_by: 7, reviewed_at: '2026-05-04', review_notes: 'Fine', paid_at: null, payment_reference: null },
  { id: 4, user_id: 10, volunteer_name: 'Bea Helper', avatar_url: null, organization_id: 114, opportunity_id: null, expense_type: 'travel', amount: 8, currency: 'EUR', description: null, status: 'paid', has_receipt: false, submitted_at: '2026-05-03 10:00:00', reviewed_by: 7, reviewed_at: '2026-05-04', review_notes: null, paid_at: '2026-05-05', payment_reference: 'BT-42' },
];

type ListState = Record<string, unknown>;
function mockList(overrides: ListState = {}) {
  const state = {
    items: CLAIMS,
    response: { data: { items: CLAIMS, stats: { total_submitted: 44.5, pending_review: 16.5, approved_total: 28, paid_total: 8 }, cursor: null, has_more: false } },
    isLoading: false,
    isLoadingMore: false,
    error: null,
    errorStatus: null,
    errorCode: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  };
  mockUsePaginatedApi.mockReturnValue(state);
  return state;
}

describe('OrgExpenses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '114' };
    mockList();
    jest.mocked(reviewOrganisationExpense).mockResolvedValue({ data: { success: true } });
    jest.mocked(downloadOrganisationExpenseReceipt).mockResolvedValue(undefined);
  });

  it('offers only the next steps the server accepts, and none on the reviewer\'s own claim', () => {
    const screen = render(<OrgExpenses />);

    expect(screen.getByTestId('org-expenses-stats')).toBeTruthy();
    expect(screen.getByText('Bus to the allotment')).toBeTruthy();
    expect(screen.getByTestId('org-expense-1-approve')).toBeTruthy();
    expect(screen.getByTestId('org-expense-1-reject')).toBeTruthy();
    expect(screen.queryByTestId('org-expense-1-mark-paid')).toBeNull();

    // My own pending claim: the note, and no buttons at all.
    expect(screen.getByTestId('org-expense-2-own')).toBeTruthy();
    expect(screen.queryByTestId('org-expense-2-approve')).toBeNull();
    expect(screen.queryByTestId('org-expense-2-reject')).toBeNull();

    expect(screen.queryByTestId('org-expense-3-approve')).toBeNull();
    expect(screen.getByTestId('org-expense-3-mark-paid')).toBeTruthy();
    expect(screen.getByText('Note: Fine')).toBeTruthy();

    expect(screen.queryByTestId('org-expense-4-actions')).toBeNull();
    expect(screen.getByText('Payment reference: BT-42')).toBeTruthy();
  });

  it('approves straight away and refreshes the list', async () => {
    const state = mockList();
    const screen = render(<OrgExpenses />);
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-1-approve')); });
    expect(reviewOrganisationExpense).toHaveBeenCalledWith(114, 1, 'approved', undefined);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Expense claim approved.' })));
    expect(state.refresh).toHaveBeenCalled();
  });

  it('rejects with the reason typed in the inline form, and pays with a payment reference', async () => {
    const screen = render(<OrgExpenses />);

    fireEvent.press(screen.getByTestId('org-expense-1-reject'));
    fireEvent.changeText(screen.getByLabelText('Reason (optional)'), 'Missing receipt');
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-1-reject-confirm')); });
    expect(reviewOrganisationExpense).toHaveBeenCalledWith(114, 1, 'rejected', { review_notes: 'Missing receipt' });

    fireEvent.press(screen.getByTestId('org-expense-3-mark-paid'));
    fireEvent.changeText(screen.getByLabelText('Payment reference (optional)'), 'BT-99');
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-3-paid-confirm')); });
    expect(reviewOrganisationExpense).toHaveBeenCalledWith(114, 3, 'paid', { payment_reference: 'BT-99' });
  });

  it('🔴 says a claim was handled by someone else, and refreshes, instead of a generic error', async () => {
    const state = mockList();
    jest.mocked(reviewOrganisationExpense).mockRejectedValueOnce(new ApiResponseError(409, 'Not pending', undefined, 'INVALID_STATE'));
    const screen = render(<OrgExpenses />);
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-1-approve')); });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'This claim has already been dealt with by someone else.' })));
    expect(state.refresh).toHaveBeenCalled();
  });

  it('shows the server\'s own refusal for any other failure', async () => {
    jest.mocked(reviewOrganisationExpense).mockRejectedValueOnce(new ApiResponseError(403, 'You cannot review your own claim.', undefined, 'FORBIDDEN'));
    const screen = render(<OrgExpenses />);
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-1-approve')); });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'You cannot review your own claim.', variant: 'danger' })));
  });

  it('fetches the receipt with the session rather than opening a bare link', async () => {
    const screen = render(<OrgExpenses />);
    await act(async () => { fireEvent.press(screen.getByTestId('org-expense-1-receipt')); });
    expect(downloadOrganisationExpenseReceipt).toHaveBeenCalledWith(114, 1);
  });

  it('asks the list for the chosen status when a filter chip is tapped', () => {
    const screen = render(<OrgExpenses />);
    fireEvent.press(screen.getByLabelText('Paid'));
    const lastCall = mockUsePaginatedApi.mock.calls.at(-1)!;
    expect(lastCall[2]).toEqual([114, 'paid']);
  });

  it('says the organisation is not theirs rather than claiming there are no claims', () => {
    mockList({ items: [], response: null, error: 'Forbidden', errorStatus: 403, errorCode: 'FORBIDDEN' });
    const screen = render(<OrgExpenses />);
    expect(screen.getByTestId('org-expenses-refused')).toBeTruthy();
    expect(screen.queryByTestId('org-expenses-empty')).toBeNull();
  });

  it('offers a retry on a load failure and an honest empty state otherwise', () => {
    const failed = mockList({ items: [], response: null, error: 'Network down', errorStatus: 500 });
    const screen = render(<OrgExpenses />);
    expect(screen.getByTestId('org-expenses-error')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    expect(failed.refresh).toHaveBeenCalled();
    screen.unmount();

    mockList({ items: [], response: { data: { items: [], stats: null, cursor: null, has_more: false } } });
    const empty = render(<OrgExpenses />);
    expect(empty.getByTestId('org-expenses-empty')).toBeTruthy();
    expect(empty.getByText('There are no claims waiting for review.')).toBeTruthy();
  });
});
