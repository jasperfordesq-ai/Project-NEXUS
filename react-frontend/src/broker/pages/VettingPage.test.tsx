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
  setSearchParams: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminVetting: mocks.adminVetting }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
  };
});

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({ user: { id: 1, role: 'admin', is_admin: true } }),
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
    expect(screen.getByText('2027-07-14')).toBeInTheDocument();
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
});
