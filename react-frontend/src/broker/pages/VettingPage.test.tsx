// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mocks = vi.hoisted(() => ({
  adminVetting: {
    list: vi.fn(),
    stats: vi.fn(),
    policy: vi.fn(),
    updatePolicy: vi.fn(),
    show: vi.fn(),
    confirm: vi.fn(),
    revoke: vi.fn(),
    resolveReview: vi.fn(),
  },
  adminUsers: { get: vi.fn() },
  setSearchParams: vi.fn(),
  // Holder so a test can deep-link (?user_id=…) before render.
  searchParams: new URLSearchParams(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  user: { id: 1, role: 'admin', is_admin: true } as Record<string, unknown>,
}));

vi.mock('@/admin/api/adminApi', () => ({ adminVetting: mocks.adminVetting, adminUsers: mocks.adminUsers }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
// The generic ui stub drops `endContent`, which is where the shared Alert
// carries its Retry button — give Alert a stub that renders all of its slots.
vi.mock('@/components/ui', async () => {
  const { uiMock } = await import('@/test/uiMock');
  const ReactLib = await import('react');
  const AlertStub = ({ title, description, endContent, role }: {
    title?: React.ReactNode; description?: React.ReactNode; endContent?: React.ReactNode; role?: string;
  }) => ReactLib.createElement('div', { role, 'data-testid': 'shared-alert' }, title, description, endContent);
  return new Proxy({}, {
    get: (_target, prop) => (prop === 'Alert' ? AlertStub : (uiMock as Record<string | symbol, unknown>)[prop]),
    has: (_target, prop) => prop !== 'then',
  });
});
// Prefixed so a test can tell a date-only render from a date-time render.
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (s: string | null) => (s ? `date:${s}` : ''),
  formatServerDateTime: (s: string | null) => (s ? `datetime:${s}` : ''),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
  };
});

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({ user: mocks.user }),
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}`, hasFeature: vi.fn((_key: string) => true), hasModule: vi.fn((_key: string) => true) }),
  useToast: () => mocks.toast,
}));

vi.mock('@/admin/components', () => ({
  DataTable: ({ data, columns, emptyContent }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{ key: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
    emptyContent?: React.ReactNode;
  }) => data.length === 0 ? <>{emptyContent}</> : (
    <table>
      <tbody>
        {data.map((item) => (
          <tr key={String(item.user_id)}>
            {columns.map((column) => (
              <td key={column.key}>{column.render?.(item)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const policy = {
  configured: true,
  contact_policy_available: true,
  jurisdiction: 'england_wales',
  scheme_code: 'dbs_england_wales',
  attestation_code: 'dbs_enhanced',
  purpose_code: 'safeguarded_member_contact',
  scope_type: 'tenant',
  scope_identifier: '2',
  policy_version: 'safeguarded-contact-v1',
  label: 'England and Wales',
  attestation_label: 'Enhanced DBS',
  preset: 'england_wales',
  certification_options: [{ code: 'dbs_enhanced', label: 'Enhanced DBS' }],
};

const policyResponse = {
  policy,
  jurisdictions: [{
    code: 'england_wales',
    label: 'England and Wales',
    attestation_code: 'dbs_enhanced',
    attestation_label: 'Enhanced DBS',
    available_for_contact_policy: true,
    contact_policy_available: true,
    certification_options: [{ code: 'dbs_enhanced', label: 'Enhanced DBS' }],
  }],
  revocation_reason_codes: ['community_decision_withdrawn'],
  review_resolution_codes: [
    'no_change',
    'duplicate_request',
    'member_contacted',
    'confirmed',
    'confirmation_withdrawn',
  ],
};

const makeMember = (overrides: Record<string, unknown> = {}) => ({
  user_id: 100,
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.test',
  avatar_url: null,
  attestation_id: null,
  decision: 'not_confirmed',
  confirmed_by: null,
  confirmed_at: null,
  revoked_by: null,
  revoked_at: null,
  revocation_reason_code: null,
  policy_version: null,
  certification_codes: [],
  scope_summary: null,
  private_notes: null,
  review_due_at: null,
  authority_expires_at: null,
  is_expired: false,
  review_request_id: 9,
  review_status: 'pending',
  requested_at: '2026-07-11T10:00:00Z',
  policy,
  ...overrides,
});

describe('VettingRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 1, role: 'admin', is_admin: true };
    mocks.searchParams = new URLSearchParams();
    mocks.adminUsers.get.mockResolvedValue({
      success: true,
      data: { id: 100, name: 'Alice Smith', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.test' },
    });
    mocks.adminVetting.list.mockResolvedValue({
      success: true,
      data: [makeMember()],
      meta: { pagination: { total: 1, current_page: 1, last_page: 1, per_page: 25 } },
    });
    mocks.adminVetting.stats.mockResolvedValue({
      success: true,
      data: { total_members: 1, confirmed: 0, revoked: 0, expired: 0, not_confirmed: 1, review_pending: 1, policy },
    });
    mocks.adminVetting.policy.mockResolvedValue({ success: true, data: policyResponse });
    mocks.adminVetting.show.mockResolvedValue({
      success: true,
      data: {
        id: 44,
        user_id: 100,
        scheme_code: 'dbs_england_wales',
        attestation_code: 'dbs_enhanced',
        certification_codes: ['dbs_enhanced'],
        purpose_code: 'safeguarded_member_contact',
        scope_type: 'tenant',
        scope_identifier: '2',
        scope_summary: 'Adult workforce befriending.',
        private_notes: 'Scope checked with safeguarding lead.',
        review_due_at: '2027-07-14',
        authority_expires_at: null,
        is_expired: false,
        decision: 'confirmed',
        confirmed_at: '2026-07-14T09:00:00Z',
        revoked_at: null,
        revocation_reason_code: null,
        policy_version: 'safeguarded-contact-v1',
        confirmed_by_name: 'Broker One',
      },
    });
    mocks.adminVetting.confirm.mockResolvedValue({ success: true, data: {} });
    mocks.adminVetting.revoke.mockResolvedValue({ success: true, data: {} });
    mocks.adminVetting.resolveReview.mockResolvedValue({ success: true, data: {} });
  });

  it('loads the metadata-only member list, stats, and policy', async () => {
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(mocks.adminVetting.list).toHaveBeenCalledWith({ status: 'all', page: 1, per_page: 25 });
    expect(mocks.adminVetting.stats).toHaveBeenCalledTimes(1);
    expect(mocks.adminVetting.policy).toHaveBeenCalledTimes(1);
  });

  it('records scope and renewal dates without collecting certificate evidence', async () => {
    const { VettingRecords } = await import('./VettingPage');
    const { container } = render(<VettingRecords />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/reference number/i)).toBeNull();
    expect(screen.queryByText(/upload document/i)).toBeNull();
    expect(screen.queryByText(/verify all/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'vetting.action_confirm' }));
    expect(screen.getByLabelText('vetting.scope_summary_label')).toBeInTheDocument();
    expect(screen.getByLabelText('vetting.review_due_label')).toBeInTheDocument();
    expect(screen.getByLabelText('vetting.authority_expiry_label')).toBeInTheDocument();
    expect(screen.getByLabelText('vetting.private_notes_label')).toBeInTheDocument();
  });

  it('requires controlled certification details and acknowledgement before confirming', async () => {
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'vetting.action_confirm' }));
    const confirmationButton = screen.getByRole('button', { name: 'vetting.confirm_button' });
    expect(confirmationButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('vetting.scope_summary_label'), {
      target: { value: 'Supervised one-to-one befriending with adults.' },
    });
    fireEvent.change(screen.getByLabelText('vetting.review_due_label'), {
      target: { value: '2027-07-14' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'vetting.confirm_button' }));

    await waitFor(() => expect(mocks.adminVetting.confirm).toHaveBeenCalledWith(100, {
      certification_codes: ['dbs_enhanced'],
      scope_summary: 'Supervised one-to-one befriending with adults.',
      review_due_at: '2027-07-14',
    }, 9));
  });

  it('opens the encrypted operational scope and private notes for authorised staff', async () => {
    mocks.adminVetting.list.mockResolvedValue({
      success: true,
      data: [makeMember({
        attestation_id: 44,
        decision: 'confirmed',
        certification_codes: ['dbs_enhanced'],
        review_status: null,
        review_request_id: null,
      })],
      meta: { pagination: { total: 1 } },
    });
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'vetting.action_details' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'vetting.action_details' }));

    await waitFor(() => expect(mocks.adminVetting.show).toHaveBeenCalledWith(44));
    expect(screen.getByText('Adult workforce befriending.')).toBeInTheDocument();
    expect(screen.getByText('Scope checked with safeguarding lead.')).toBeInTheDocument();
    // Dates go through the shared formatter (date-only), never the raw string.
    expect(screen.getByText('date:2027-07-14')).toBeInTheDocument();
    expect(screen.queryByText('2027-07-14')).toBeNull();
  });

  // ─── ?user_id= deep link (from Members → "Check Vetting") ──────────────────

  it('honours ?user_id=: loads that member, filters the list and shows a clearable banner', async () => {
    mocks.searchParams = new URLSearchParams('user_id=100');
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(mocks.adminUsers.get).toHaveBeenCalledWith(100));
    // The list endpoint has no user_id filter, so the member's email drives
    // the server-side search and the rows are narrowed to that member.
    await waitFor(() => expect(mocks.adminVetting.list).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'alice@example.test' }),
    ));
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByText('vetting.member_filter_banner')).toBeInTheDocument();
    // The stat cards still show tenant totals.
    expect(mocks.adminVetting.stats).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'vetting.member_filter_clear' }));
    expect(mocks.setSearchParams).toHaveBeenCalled();
  });

  it('drops rows that belong to other members when ?user_id= is set', async () => {
    mocks.searchParams = new URLSearchParams('user_id=100');
    mocks.adminVetting.list.mockResolvedValue({
      success: true,
      data: [makeMember(), makeMember({ user_id: 200, first_name: 'Bob', last_name: 'Jones', email: 'bob@example.test' })],
      meta: { pagination: { total: 2 } },
    });
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByText('Bob Jones')).toBeNull();
  });

  it('shows no banner and sends no search when there is no ?user_id=', async () => {
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(mocks.adminUsers.get).not.toHaveBeenCalled();
    expect(screen.queryByText('vetting.member_filter_banner')).toBeNull();
  });

  // ─── Stats failure ─────────────────────────────────────────────────────────

  it('shows a warning alert with Retry when the stats fail, and retries on press', async () => {
    mocks.adminVetting.stats.mockRejectedValueOnce(new Error('boom'));
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'shared-alert');
    expect(alert.textContent).toContain('vetting.stats_error_title');
    fireEvent.click(screen.getByRole('button', { name: 'vetting.retry' }));
    await waitFor(() => expect(mocks.adminVetting.stats).toHaveBeenCalledTimes(2));
  });

  it('revokes with a controlled reason code', async () => {
    mocks.adminVetting.list.mockResolvedValue({
      success: true,
      data: [makeMember({ decision: 'confirmed', review_status: null, review_request_id: null })],
      meta: { pagination: { total: 1 } },
    });
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'vetting.action_revoke' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'vetting.action_revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'vetting.revoke_button' }));

    await waitFor(() => expect(mocks.adminVetting.revoke).toHaveBeenCalledWith(
      100,
      'community_decision_withdrawn',
      null,
    ));
  });

  it('defaults review resolution to no change and excludes gate-changing outcomes', async () => {
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'vetting.action_resolve' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'vetting.action_resolve' }));
    expect(screen.queryByText('vetting.resolution_confirmed')).toBeNull();
    expect(screen.queryByText('vetting.resolution_confirmation_withdrawn')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'vetting.resolve_button' }));

    await waitFor(() => expect(mocks.adminVetting.resolveReview).toHaveBeenCalledWith(9, 'no_change'));
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('disables confirmation when the jurisdiction policy is unavailable', async () => {
    const unavailable = { ...policy, configured: false, contact_policy_available: false, jurisdiction: 'unconfigured' };
    mocks.adminVetting.policy.mockResolvedValue({
      success: true,
      data: { ...policyResponse, policy: unavailable },
    });
    mocks.adminVetting.stats.mockResolvedValue({
      success: true,
      data: { total_members: 1, confirmed: 0, revoked: 0, expired: 0, not_confirmed: 1, review_pending: 1, policy: unavailable },
    });

    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'vetting.action_confirm' })).toBeDisabled());
  });
  // Owner decision, 3 Oct 2026: only an admin chooses the safeguarding
  // jurisdiction, but everyone sees it, marked Admin only.
  it('shows a broker the jurisdiction read-only, marked Admin only', async () => {
    mocks.user = { id: 2, role: 'broker' };
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    expect(await screen.findByText('vetting.jurisdiction_label')).toBeInTheDocument();
    expect(screen.getByText('admin_only.label')).toBeInTheDocument();
    expect(screen.getByText('vetting.jurisdiction_admin_only_hint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'vetting.save_jurisdiction' })).toBeNull();
  });

  it('F-550: shows a coordinator the records with no decision buttons, and says why', async () => {
    mocks.user = { id: 3, role: 'coordinator' };
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByText('vetting.coordinator_view_only')).toBeInTheDocument();
    for (const name of ['vetting.action_confirm', 'vetting.action_renew', 'vetting.action_revoke', 'vetting.action_resolve']) {
      expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull();
    }
  });

  it('F-550 control: a broker still gets the decision buttons and no coordinator note', async () => {
    mocks.user = { id: 2, role: 'broker' };
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByText('vetting.coordinator_view_only')).toBeNull();
    expect(screen.getAllByRole('button', { name: /vetting\.action_(confirm|renew|revoke)/ }).length).toBeGreaterThan(0);
  });

  it('lets an admin choose the jurisdiction, with no Admin only mark', async () => {
    const { VettingRecords } = await import('./VettingPage');
    render(<VettingRecords />);

    expect(await screen.findByRole('button', { name: 'vetting.save_jurisdiction' })).toBeInTheDocument();
    expect(screen.queryByText('admin_only.label')).toBeNull();
    expect(screen.queryByText('vetting.jurisdiction_admin_only_hint')).toBeNull();
  });
});
