// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The four vetting modals extracted from VettingPage. They are rendered with
 * the shared lightweight UI stub (as VettingPage's own tests are) so the
 * assertions are about what each modal sends and shows, not HeroUI internals.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { VettingRecord } from '@/admin/api/types';

const mocks = vi.hoisted(() => ({
  adminVetting: { show: vi.fn(), confirm: vi.fn(), revoke: vi.fn(), resolveReview: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminVetting: mocks.adminVetting }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mocks.toast }));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (s: string | null) => (s ? `date:${s}` : ''),
  formatServerDateTime: (s: string | null) => (s ? `datetime:${s}` : ''),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { VettingConfirmModal } from './VettingConfirmModal';
import { VettingDetailModal } from './VettingDetailModal';
import { VettingRevokeModal } from './VettingRevokeModal';
import { VettingResolveModal } from './VettingResolveModal';

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
} as unknown as VettingRecord['policy'];

const member = (overrides: Partial<VettingRecord> = {}): VettingRecord => ({
  user_id: 100,
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.test',
  avatar_url: null,
  attestation_id: null,
  decision: 'not_confirmed',
  certification_codes: [],
  is_expired: false,
  confirmed_by: null,
  confirmed_at: null,
  revoked_by: null,
  revoked_at: null,
  revocation_reason_code: null,
  review_due_at: null,
  authority_expires_at: null,
  policy_version: null,
  review_request_id: 9,
  review_status: 'pending',
  requested_at: '2026-07-11T10:00:00Z',
  policy,
  ...overrides,
});

describe('VettingConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminVetting.confirm.mockResolvedValue({ success: true, data: {} });
  });

  it('starts from the only available scheme and requires scope, date and acknowledgement', async () => {
    const onClose = vi.fn();
    const onConfirmed = vi.fn();
    render(<VettingConfirmModal item={member()} canRecordDecision onClose={onClose} onConfirmed={onConfirmed} />);

    const submit = screen.getByRole('button', { name: 'vetting.confirm_button' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('vetting.scope_summary_label'), {
      target: { value: 'Supervised one-to-one befriending with adults.' },
    });
    fireEvent.change(screen.getByLabelText('vetting.review_due_label'), { target: { value: '2027-07-14' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.adminVetting.confirm).toHaveBeenCalledWith(100, {
      certification_codes: ['dbs_enhanced'],
      scope_summary: 'Supervised one-to-one befriending with adults.',
      review_due_at: '2027-07-14',
    }, 9));
    expect(mocks.toast.success).toHaveBeenCalledWith('vetting.toast_confirmed');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('collects no certificate evidence', () => {
    const { container } = render(
      <VettingConfirmModal item={member()} canRecordDecision onClose={vi.fn()} onConfirmed={vi.fn()} />,
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText('vetting.privacy_body')).toBeInTheDocument();
  });

  it('keeps the modal open and shows the server message when the confirmation is refused', async () => {
    mocks.adminVetting.confirm.mockResolvedValue({ success: false, error: 'Policy mismatch' });
    const onClose = vi.fn();
    render(<VettingConfirmModal item={member()} canRecordDecision onClose={onClose} onConfirmed={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('vetting.scope_summary_label'), { target: { value: 'Scope' } });
    fireEvent.change(screen.getByLabelText('vetting.review_due_label'), { target: { value: '2027-07-14' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'vetting.confirm_button' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Policy mismatch'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('VettingRevokeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminVetting.revoke.mockResolvedValue({ success: true, data: {} });
  });

  it('preselects the first controlled reason and revokes with it', async () => {
    const onRevoked = vi.fn();
    render(
      <VettingRevokeModal
        item={member({ decision: 'confirmed', attestation_id: 44 })}
        reasonCodes={['community_decision_withdrawn', 'recorded_in_error']}
        canRecordDecision
        onClose={vi.fn()}
        onRevoked={onRevoked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'vetting.revoke_button' }));
    await waitFor(() => expect(mocks.adminVetting.revoke).toHaveBeenCalledWith(100, 'community_decision_withdrawn', 9));
    expect(mocks.toast.success).toHaveBeenCalledWith('vetting.toast_revoked');
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the jurisdiction policy is unavailable', () => {
    render(
      <VettingRevokeModal
        item={member({ decision: 'confirmed' })}
        reasonCodes={['community_decision_withdrawn']}
        canRecordDecision={false}
        onClose={vi.fn()}
        onRevoked={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'vetting.revoke_button' }));
    expect(mocks.adminVetting.revoke).not.toHaveBeenCalled();
  });
});

describe('VettingResolveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminVetting.resolveReview.mockResolvedValue({ success: true, data: {} });
  });

  it('defaults to "no change" and resolves the review request with it', async () => {
    const onResolved = vi.fn();
    render(
      <VettingResolveModal
        item={member()}
        resolutionCodes={['no_change', 'duplicate_request', 'member_contacted']}
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );
    // Only gate-neutral outcomes are offered.
    expect(screen.queryByText('vetting.resolution_confirmed')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'vetting.resolve_button' }));
    await waitFor(() => expect(mocks.adminVetting.resolveReview).toHaveBeenCalledWith(9, 'no_change'));
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('cannot submit when "no change" is not offered and nothing is chosen', () => {
    render(
      <VettingResolveModal item={member()} resolutionCodes={['duplicate_request']} onClose={vi.fn()} onResolved={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'vetting.resolve_button' })).toBeDisabled();
  });
});

describe('VettingDetailModal', () => {
  const certificationLabel = (code: string) => `label:${code}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminVetting.show.mockResolvedValue({
      success: true,
      data: {
        id: 44,
        user_id: 100,
        certification_codes: ['dbs_enhanced'],
        scope_summary: 'Adult workforce befriending.',
        private_notes: 'Scope checked with safeguarding lead.',
        review_due_at: '2027-07-14',
        authority_expires_at: null,
      },
    });
  });

  it('loads the attestation and shows scope, private notes and dates through the shared formatter', async () => {
    render(
      <VettingDetailModal
        item={member({ attestation_id: 44, decision: 'confirmed' })}
        certificationLabel={certificationLabel}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.adminVetting.show).toHaveBeenCalledWith(44));
    expect(await screen.findByText('Adult workforce befriending.')).toBeInTheDocument();
    expect(screen.getByText('Scope checked with safeguarding lead.')).toBeInTheDocument();
    expect(screen.getByText('label:dbs_enhanced')).toBeInTheDocument();
    expect(screen.getByText('date:2027-07-14')).toBeInTheDocument();
    expect(screen.getByText('vetting.not_applicable')).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    mocks.adminVetting.show.mockResolvedValue({ success: false, error: 'Gone' });
    render(
      <VettingDetailModal item={member({ attestation_id: 44 })} certificationLabel={certificationLabel} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Gone'));
  });
});

// Keep React in scope for the JSX in this file under the classic runtime guard.
void React;
