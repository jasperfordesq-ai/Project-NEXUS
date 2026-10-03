// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member window's record tabs. None of the broker list endpoints filters
 * by member, so each tab must (a) ask for the full-size page, (b) keep only
 * the member's rows, (c) say when the page cap was hit, and (d) link to the
 * broker page. Monitoring additionally adds / extends through
 * `adminBroker.setMonitoring` with the Monitoring page's payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const { broker, apiGet, mockToast } = vi.hoisted(() => ({
  broker: {
    getExchanges: vi.fn(),
    getMessages: vi.fn(),
    getMonitoring: vi.fn(),
    setMonitoring: vi.fn(),
    getRiskTags: vi.fn(),
  },
  apiGet: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminBroker: broker }));
vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/contexts', () => ({
  useToast: () => mockToast,
  useTenant: () => ({ tenantPath: (p: string) => `/t${p}` }),
}));
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (s: string) => (s ? `date:${s}` : ''),
  formatServerDateTime: (s: string) => (s ? `datetime:${s}` : ''),
  parseServerTimestamp: (s: string) => (s ? new Date(s) : null),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).some((k) => k !== 'defaultValue')
        ? `${key}:${Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([, v]) => String(v)).join(',')}`
        : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { MemberExchangesTab } from './MemberExchangesTab';
import { MemberMessagesTab } from './MemberMessagesTab';
import { MemberMonitoringTab } from './MemberMonitoringTab';
import { MemberRiskTagsTab, riskTagBelongsTo } from './MemberRiskTagsTab';
import { MemberSupportNeedsTab, SUPPORT_NEEDS_ENDPOINT } from './MemberSupportNeedsTab';

const page = <T,>(rows: T[], hasMore = false) => ({ success: true, data: rows, meta: { has_more: hasMore, total: rows.length } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MemberExchangesTab', () => {
  it('asks for 100 per page, keeps the member\'s exchanges as requester or provider, and links each', async () => {
    broker.getExchanges.mockResolvedValue(page([
      { id: 11, requester_id: 5, requester_name: 'Dana', provider_id: 9, provider_name: 'Pat', listing_title: 'Garden help', status: 'completed', final_hours: 2, created_at: '2026-09-01' },
      { id: 12, requester_id: 9, requester_name: 'Pat', provider_id: 5, provider_name: 'Dana', listing_title: 'Lift to town', status: 'pending_broker', created_at: '2026-09-02' },
      { id: 13, requester_id: 1, requester_name: 'Other', provider_id: 2, provider_name: 'Else', listing_title: 'Not theirs', status: 'completed', created_at: '2026-09-03' },
    ]));
    render(<MemberExchangesTab userId={5} />);

    await waitFor(() => expect(broker.getExchanges).toHaveBeenCalledWith({ page: 1, per_page: 100 }));
    expect(await screen.findByText('Garden help')).toBeInTheDocument();
    expect(screen.getByText('Lift to town')).toBeInTheDocument();
    expect(screen.queryByText('Not theirs')).not.toBeInTheDocument();
    // Both of Dana's exchanges are with Pat — one as requester, one as provider.
    expect(screen.getAllByText('member_detail.exchange_with:Pat')).toHaveLength(2);
    expect(screen.getByText('member_detail.exchange_role_requester')).toBeInTheDocument();
    expect(screen.getByText('member_detail.exchange_role_provider')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Garden help' })).toHaveAttribute('href', '/t/broker/exchanges/11');
    expect(screen.getByRole('link', { name: /member_detail\.see_all/ })).toHaveAttribute('href', '/t/broker/exchanges');
  });

  it('shows the empty state when the member has none', async () => {
    broker.getExchanges.mockResolvedValue(page([]));
    render(<MemberExchangesTab userId={5} />);
    expect(await screen.findByText('member_detail.exchanges_empty_title')).toBeInTheDocument();
  });

  it('pages through the list and says when the cap was hit', async () => {
    broker.getExchanges.mockImplementation(async ({ page: p }: { page: number }) =>
      page([{ id: p, requester_id: 5, provider_id: 1, requester_name: 'D', provider_name: 'X', status: 'completed', created_at: '2026-01-01' }], true),
    );
    render(<MemberExchangesTab userId={5} />);
    await waitFor(() => expect(broker.getExchanges).toHaveBeenCalledTimes(5));
    expect(await screen.findByText('member_detail.partial_results:500')).toBeInTheDocument();
  });

  it('shows an error with Retry instead of an empty list when the load fails', async () => {
    broker.getExchanges.mockRejectedValueOnce(new Error('boom'));
    broker.getExchanges.mockResolvedValue(page([]));
    render(<MemberExchangesTab userId={5} />);
    expect(await screen.findByText('member_detail.section_load_failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'member_detail.retry' }));
    expect(await screen.findByText('member_detail.exchanges_empty_title')).toBeInTheDocument();
  });
});

describe('MemberMessagesTab', () => {
  it('narrows by the member\'s name on the server, then keeps only their copies', async () => {
    broker.getMessages.mockResolvedValue(page([
      { id: 1, sender_id: 5, sender_name: 'Dana', receiver_id: 9, receiver_name: 'Pat', flagged: false, created_at: '2026-09-01' },
      { id: 2, sender_id: 9, sender_name: 'Pat', receiver_id: 5, receiver_name: 'Dana', flagged: true, reviewed_at: '2026-09-02', created_at: '2026-09-02' },
      { id: 3, sender_id: 7, sender_name: 'Dana Smith', receiver_id: 8, receiver_name: 'Z', flagged: false, created_at: '2026-09-03' },
    ]));
    render(<MemberMessagesTab userId={5} memberName="Dana" />);

    await waitFor(() => expect(broker.getMessages).toHaveBeenCalledWith({ page: 1, per_page: 100, q: 'Dana' }));
    expect(await screen.findByText('member_detail.message_to:Pat')).toBeInTheDocument();
    expect(screen.getByText('member_detail.message_from:Pat')).toBeInTheDocument();
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/t/broker/messages/'))).toHaveLength(2);
    expect(screen.getByText('messages.flagged_label')).toBeInTheDocument();
    expect(screen.getByText('messages.status_reviewed')).toBeInTheDocument();
    expect(screen.getByText('messages.status_unreviewed')).toBeInTheDocument();
  });
});

describe('MemberMonitoringTab', () => {
  it('offers "Add to monitoring" when the member is not monitored and posts the Monitoring page payload', async () => {
    broker.getMonitoring.mockResolvedValue({ success: true, data: [{ id: 1, user_id: 9, user_name: 'Someone else', under_monitoring: true }] });
    broker.setMonitoring.mockResolvedValue({ success: true });
    const onChanged = vi.fn();
    render(<MemberMonitoringTab userId={5} onChanged={onChanged} />);

    expect(await screen.findByText('member_detail.monitoring_empty_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'member_detail.monitoring_add' }));

    // A reason is required.
    fireEvent.click(screen.getAllByRole('button', { name: 'member_detail.monitoring_add' })[0] as HTMLElement);
    expect(mockToast.error).toHaveBeenCalledWith('monitoring.reason_required');
    expect(broker.setMonitoring).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('monitoring.reason_placeholder'), { target: { value: 'New member, first month' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'member_detail.monitoring_add' })[0] as HTMLElement);

    await waitFor(() =>
      expect(broker.setMonitoring).toHaveBeenCalledWith(5, { under_monitoring: true, reason: 'New member, first month' }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('member_detail.monitoring_added');
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(broker.getMonitoring).toHaveBeenCalledTimes(2));
  });

  it('shows the active record with its dates and offers "Extend", prefilled with the reason', async () => {
    broker.getMonitoring.mockResolvedValue({
      success: true,
      data: [{ id: 2, user_id: 5, user_name: 'Dana', under_monitoring: true, monitoring_reason: 'Concern raised', monitoring_started_at: '2026-09-01', monitoring_expires_at: '2099-01-01', messaging_disabled: false }],
    });
    broker.setMonitoring.mockResolvedValue({ success: true });
    render(<MemberMonitoringTab userId={5} />);

    expect(await screen.findByText('member_detail.monitoring_since:date:2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('member_detail.monitoring_until:date:2099-01-01')).toBeInTheDocument();
    expect(screen.getByText('Concern raised')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /member_detail\.see_all/ })).toHaveAttribute('href', '/t/broker/monitoring');

    fireEvent.click(screen.getByRole('button', { name: 'member_detail.monitoring_extend' }));
    expect(screen.getByDisplayValue('Concern raised')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'member_detail.monitoring_extend' })[0] as HTMLElement);

    // No duration picked: the remaining time is kept, never cleared.
    await waitFor(() => expect(broker.setMonitoring).toHaveBeenCalled());
    const payload = broker.setMonitoring.mock.calls[0]?.[1] as { under_monitoring: boolean; reason: string; expires_days?: number };
    expect(payload.under_monitoring).toBe(true);
    expect(payload.reason).toBe('Concern raised');
    expect(payload.expires_days).toBeGreaterThan(1);
    expect(mockToast.success).toHaveBeenCalledWith('member_detail.monitoring_extended');
    // The tab re-reads the monitoring list after the change.
    await waitFor(() => expect(broker.getMonitoring).toHaveBeenCalledTimes(2));
  });
});

describe('MemberRiskTagsTab', () => {
  it('matches by owner id when the row has one, else by the owner\'s name', () => {
    expect(riskTagBelongsTo({ owner_id: 5, owner_name: 'Other' } as never, 5, 'Dana')).toBe(true);
    expect(riskTagBelongsTo({ owner_id: 6, owner_name: 'Dana' } as never, 5, 'Dana')).toBe(false);
    expect(riskTagBelongsTo({ owner_name: 'Dana' } as never, 5, 'Dana')).toBe(true);
    expect(riskTagBelongsTo({ owner_name: 'Dana' } as never, 5, 'Pat')).toBe(false);
    expect(riskTagBelongsTo({ owner_name: 'Dana' } as never, 5, '')).toBe(false);
  });

  it('lists the member\'s tags with level, category and flags, and says how they were matched', async () => {
    broker.getRiskTags.mockResolvedValue({
      success: true,
      data: [
        { id: 1, listing_id: 10, listing_title: 'Ladder work', owner_name: 'Dana', risk_level: 'high', risk_category: 'health_safety', requires_approval: true, insurance_required: true, dbs_required: false, tagged_by_name: 'Broker B', created_at: '2026-09-01' },
        { id: 2, listing_id: 11, listing_title: 'Not hers', owner_name: 'Pat', risk_level: 'low', risk_category: 'legal', requires_approval: false, insurance_required: false, dbs_required: false, created_at: '2026-09-01' },
      ],
    });
    render(<MemberRiskTagsTab userId={5} memberName="Dana" />);

    await waitFor(() => expect(broker.getRiskTags).toHaveBeenCalledWith({}));
    expect(await screen.findByText('Ladder work')).toBeInTheDocument();
    expect(screen.queryByText('Not hers')).not.toBeInTheDocument();
    expect(screen.getByText('risk_tags.level_high')).toBeInTheDocument();
    expect(screen.getByText('risk_tags.category_health_safety')).toBeInTheDocument();
    expect(screen.getByText('risk_tags.col_approval_req')).toBeInTheDocument();
    expect(screen.getByText('member_detail.risk_tags_name_match_hint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /member_detail\.see_all/ })).toHaveAttribute('href', '/t/broker/risk-tags');
  });
});

describe('MemberSupportNeedsTab', () => {
  it('reads the Support needs endpoint, keeps the member\'s entry and links to the page focused on them', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: [
        { user_id: 5, user_name: 'Dana', options: [{ option_key: 'a', label: 'Phone calls first', is_declination: false }], consent_given_at: '2026-09-05', has_triggers: true, is_declination_only: false, protections: ['vetted_only'], needs_review: true },
        { user_id: 6, user_name: 'Pat', options: [], consent_given_at: '2026-09-05', has_triggers: false, is_declination_only: true },
      ],
    });
    render(<MemberSupportNeedsTab userId={5} />);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(SUPPORT_NEEDS_ENDPOINT));
    expect(await screen.findByText('Phone calls first')).toBeInTheDocument();
    expect(screen.getByText('member_detail.support_needs_unseen')).toBeInTheDocument();
    expect(screen.getByText('member_detail.support_needs_answered:date:2026-09-05')).toBeInTheDocument();
    expect(screen.getByText('member_detail.support_needs_protections:1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /member_detail\.see_all/ })).toHaveAttribute('href', '/t/broker/safeguarding/support-needs?user=5');
  });

  it('shows the empty state when the member has not answered', async () => {
    apiGet.mockResolvedValue({ success: true, data: [] });
    render(<MemberSupportNeedsTab userId={5} />);
    expect(await screen.findByText('member_detail.support_needs_empty_title')).toBeInTheDocument();
  });
});
