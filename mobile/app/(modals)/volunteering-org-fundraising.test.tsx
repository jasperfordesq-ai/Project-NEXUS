// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockPush = jest.fn();
let mockRouteParams: Record<string, string> = { id: '114' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'fundraising.title': 'Fundraising',
        'fundraising.intro': 'Campaigns you run here go live straight away.',
        'fundraising.newCampaign': 'New campaign',
        'fundraising.editCampaign': 'Edit campaign',
        'fundraising.editCampaignLabel': `Edit the campaign ${String(o.title ?? '')}`,
        'fundraising.empty': 'Your organisation has no fundraising campaigns yet.',
        'fundraising.loadError': 'Could not load your campaigns.',
        'fundraising.notYoursTitle': 'You do not manage this organisation',
        'fundraising.notYoursHint': 'Only its owners and admins can run its fundraising.',
        'fundraising.status.active': 'Live',
        'fundraising.status.upcoming': 'Coming up',
        'fundraising.status.paused': 'Paused',
        'fundraising.status.ended': 'Ended',
        'fundraising.raisedOfGoal': `${String(o.raised ?? '')} raised of ${String(o.goal ?? '')}`,
        'fundraising.dateRange': `${String(o.start ?? '')} – ${String(o.end ?? '')}`,
        'fundraising.pause': 'Pause',
        'fundraising.pauseLabel': `Pause the campaign ${String(o.title ?? '')}`,
        'fundraising.resume': 'Resume',
        'fundraising.resumeLabel': `Resume the campaign ${String(o.title ?? '')}`,
        'fundraising.end': 'End campaign',
        'fundraising.endLabel': `End the campaign ${String(o.title ?? '')}`,
        'fundraising.endTitle': 'End this campaign?',
        'fundraising.endMessage': 'Members will no longer be able to give to it.',
        'fundraising.saved': 'Campaign saved.',
        'fundraising.updateFailed': 'Could not update this campaign.',
        'fundraising.showDetails': 'Show details',
        'fundraising.hideDetails': 'Hide details',
        'fundraising.detailsError': 'Could not load the gifts and hand-overs.',
        'fundraising.gifts': 'Gifts',
        'fundraising.noGifts': 'No gifts yet.',
        'fundraising.anonymous': 'Anonymous',
        'fundraising.method.card': 'Card',
        'fundraising.method.pledge': 'Pledge',
        'fundraising.giftStatus.completed': 'Paid',
        'fundraising.handovers': 'Hand-overs',
        'fundraising.raised': 'Raised',
        'fundraising.handedOver': 'Passed on',
        'fundraising.stillHeld': 'Still held',
        'fundraising.noHandovers': 'No money has been passed on yet.',
        'fundraising.handoverStatus.recorded': 'Waiting for confirmation',
        'fundraising.handoverStatus.confirmed': 'Confirmed',
        'fundraising.handoverStatus.cancelled': 'Cancelled',
        'fundraising.handoverMethod.bank_transfer': 'Bank transfer',
        'fundraising.recordedBy': `Recorded by ${String(o.name ?? '')}`,
        'fundraising.confirmedBy': `Confirmed by ${String(o.name ?? '')}`,
        'fundraising.confirmReceived': 'Confirm received',
        'fundraising.confirmReceivedLabel': `Confirm you received ${String(o.amount ?? '')}`,
        'fundraising.confirmReceivedTitle': 'Confirm this hand-over?',
        'fundraising.confirmReceivedMessage': `Only confirm once ${String(o.amount ?? '')} has reached your organisation.`,
        'fundraising.handoverConfirmed': 'Thank you — receipt confirmed.',
        'fundraising.handoverFailed': 'Could not confirm this hand-over.',
        'fundraising.history': 'History',
        'fundraising.noHistory': 'Nothing has been recorded for this campaign yet.',
        'fundraising.by': `by ${String(o.name ?? '')}`,
        'fundraising.actor.community_admin': 'Community admin',
        'fundraising.event.campaign_created': 'Campaign created',
        'fundraising.event.campaign_updated': 'Campaign edited',
        'fundraising.field.goal_amount': 'Goal',
        'fundraising.change': `${String(o.field)} changed from ${String(o.from)} to ${String(o.to)}`,
        'fundraising.emptyValue': '(none)',
        'fundraising.giftNumber': `Gift #${String(o.number ?? '')}`,
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
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank', currency: 'EUR' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', errorBg: '#fee2e2', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, message, cancelLabel, confirmLabel, cancelTestID, confirmTestID, onClose, onConfirm }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Text>{message as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}><Text>{cancelLabel as string}</Text></Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}><Text>{confirmLabel as string}</Text></Pressable>
        </View>
      ) : null,
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => mockUseApi(...args) }));
jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return {
    ...actual,
    getOrganisationCampaigns: jest.fn(() => 'campaigns'),
    getCampaignGifts: jest.fn(() => 'gifts'),
    getCampaignHandovers: jest.fn(() => 'handovers'),
    getCampaignHistory: jest.fn(() => 'history'),
    updateOrganisationCampaign: jest.fn(),
    confirmHandover: jest.fn(),
    todayDateOnly: () => '2026-10-08',
  };
});

import { confirmHandover, updateOrganisationCampaign } from '@/lib/api/volunteeringOrganiser';
import OrgFundraising from './volunteering-org-fundraising';

type ApiState = { data: unknown; isLoading: boolean; error: string | null; errorStatus: number | null; errorCode: string | null; refresh: jest.Mock };
const ok = (data: unknown, refresh = jest.fn()): ApiState => ({ data, isLoading: false, error: null, errorStatus: null, errorCode: null, refresh });

const CAMPAIGNS = [
  { id: 9, title: 'Winter appeal', description: 'Coats', start_date: '2026-10-01', end_date: '2026-12-01', goal_amount: '500.00', raised_amount: 120, is_active: true, status: 'active' },
  { id: 10, title: 'Paused drive', start_date: '2026-09-01', end_date: '2026-12-01', goal_amount: 100, raised_amount: 0, is_active: false, status: 'paused' },
  { id: 11, title: 'Old appeal', start_date: '2025-01-01', end_date: '2025-02-01', goal_amount: 100, raised_amount: 100, is_active: false, status: 'ended' },
];

function mockApis(states: Partial<Record<'campaigns' | 'gifts' | 'handovers' | 'history', ApiState>> = {}) {
  const defaults: Record<string, ApiState> = {
    campaigns: ok({ data: { items: CAMPAIGNS } }),
    gifts: ok({ data: { items: [{ id: 1, amount: 20, amount_refunded: 0, currency: 'EUR', status: 'completed', created_at: '2026-10-02 10:00:00', display_name: null, payment_method: 'card' }] } }),
    handovers: ok({
      data: {
        summary: { raised: 120, handed_over: 50, still_held: 70, currency: 'EUR' },
        items: [{ id: 3, giving_day_id: 9, organization_id: 114, amount: 50, currency: 'EUR', handed_over_on: '2026-10-05', method: 'bank_transfer', reference: 'REF-1', note: null, status: 'recorded', recorded_by_name: 'Ann Admin', created_at: '2026-10-05 10:00:00', confirmed_by_name: null, confirmed_at: null, cancelled_by_name: null, cancelled_at: null, cancel_reason: null }],
      },
    }),
    history: ok({ data: { items: [{ id: 5, event: 'campaign_updated', actor_kind: 'community_admin', actor_name: null, amount: null, currency: null, donation_id: null, handover_id: null, details: { changes: { goal_amount: { from: 400, to: 500 } } }, created_at: '2026-10-03 09:00:00' }] } }),
  };
  mockUseApi.mockImplementation((fetchFn: () => unknown, _deps: unknown[], options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return ok(null);
    const tag = fetchFn() as string;
    return states[tag as 'campaigns'] ?? defaults[tag];
  });
}

describe('OrgFundraising', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '114' };
    mockApis();
    jest.mocked(updateOrganisationCampaign).mockResolvedValue({ data: { success: true } });
    jest.mocked(confirmHandover).mockResolvedValue({ data: {} });
  });

  it('lists the campaigns with their state and offers only the actions that make sense for each', () => {
    const screen = render(<OrgFundraising />);

    expect(screen.getByText('Winter appeal')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('€120.00 raised of €500.00')).toBeTruthy();
    expect(screen.getByTestId('campaign-9-pause')).toBeTruthy();
    expect(screen.queryByTestId('campaign-9-resume')).toBeNull();
    expect(screen.getByTestId('campaign-10-resume')).toBeTruthy();
    expect(screen.queryByTestId('campaign-11-pause')).toBeNull();
    expect(screen.queryByTestId('campaign-11-end')).toBeNull();
    expect(screen.getByTestId('campaign-11-edit')).toBeTruthy();
  });

  it('opens the campaign form to create and to edit', () => {
    const screen = render(<OrgFundraising />);
    fireEvent.press(screen.getByTestId('org-fundraising-new'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-org-campaign-form', params: { id: '114' } });
    fireEvent.press(screen.getByTestId('campaign-9-edit'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-org-campaign-form', params: { id: '114', campaignId: '9' } });
  });

  it('pauses and resumes with one tap, but ends only after confirmation with today as the end date', async () => {
    const screen = render(<OrgFundraising />);

    await act(async () => { fireEvent.press(screen.getByTestId('campaign-9-pause')); });
    expect(updateOrganisationCampaign).toHaveBeenCalledWith(114, 9, { is_active: false });
    await act(async () => { fireEvent.press(screen.getByTestId('campaign-10-resume')); });
    expect(updateOrganisationCampaign).toHaveBeenCalledWith(114, 10, { is_active: true });

    fireEvent.press(screen.getByTestId('campaign-9-end'));
    expect(updateOrganisationCampaign).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.press(screen.getByTestId('campaign-end-confirm')); });
    expect(updateOrganisationCampaign).toHaveBeenLastCalledWith(114, 9, { is_active: false, end_date: '2026-10-08' });
  });

  it('shows the server\'s refusal when a change is not allowed', async () => {
    jest.mocked(updateOrganisationCampaign).mockRejectedValueOnce(new ApiResponseError(422, 'This organisation is no longer approved.', undefined, 'VALIDATION_ERROR'));
    const screen = render(<OrgFundraising />);
    await act(async () => { fireEvent.press(screen.getByTestId('campaign-9-pause')); });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This organisation is no longer approved.', variant: 'danger' })));
  });

  it('🔴 shows gifts, hand-overs and history on demand, and confirms a hand-over only after asking', async () => {
    const screen = render(<OrgFundraising />);
    expect(screen.queryByTestId('campaign-9-details')).toBeNull();

    fireEvent.press(screen.getByTestId('campaign-9-toggle-details'));
    expect(screen.getByTestId('campaign-9-details')).toBeTruthy();
    expect(screen.getByText('Anonymous')).toBeTruthy();
    expect(screen.getByText('Waiting for confirmation')).toBeTruthy();
    expect(screen.getByText('Recorded by Ann Admin')).toBeTruthy();
    expect(screen.getByText('Campaign edited')).toBeTruthy();
    expect(screen.getByText('Goal changed from 400 to 500')).toBeTruthy();

    fireEvent.press(screen.getByTestId('campaign-handover-3-confirm'));
    expect(confirmHandover).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('campaign-handover-confirm')); });
    expect(confirmHandover).toHaveBeenCalledWith(114, 3);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thank you — receipt confirmed.' })));
  });

  it('offers a retry when a campaign\'s details fail, without losing the list', () => {
    const refresh = jest.fn();
    mockApis({ gifts: { data: null, isLoading: false, error: 'Network down', errorStatus: 500, errorCode: null, refresh } });
    const screen = render(<OrgFundraising />);
    fireEvent.press(screen.getByTestId('campaign-9-toggle-details'));
    expect(screen.getByTestId('campaign-9-details-error')).toBeTruthy();
    expect(screen.getByText('Winter appeal')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });

  it('says the organisation is not theirs rather than claiming it has no campaigns', () => {
    mockApis({ campaigns: { data: null, isLoading: false, error: 'Forbidden', errorStatus: 403, errorCode: 'FORBIDDEN', refresh: jest.fn() } });
    const screen = render(<OrgFundraising />);
    expect(screen.getByTestId('org-fundraising-refused')).toBeTruthy();
    expect(screen.queryByTestId('org-fundraising-empty')).toBeNull();
  });

  it('offers a retry on a load failure and an honest empty state otherwise', () => {
    const refresh = jest.fn();
    mockApis({ campaigns: { data: null, isLoading: false, error: 'Network down', errorStatus: 500, errorCode: null, refresh } });
    const failed = render(<OrgFundraising />);
    expect(failed.getByTestId('org-fundraising-error')).toBeTruthy();
    fireEvent.press(failed.getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
    failed.unmount();

    mockApis({ campaigns: ok({ data: { items: [] } }) });
    const empty = render(<OrgFundraising />);
    expect(empty.getByTestId('org-fundraising-empty')).toBeTruthy();
  });
});
