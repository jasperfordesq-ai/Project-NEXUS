// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// ─── Hoisted API mocks ────────────────────────────────────────────────────────
const { api, mockConfirm } = vi.hoisted(() => ({
  // The shared confirm dialog, controllable per test: resolve true = "Yes".
  mockConfirm: vi.fn(),
  api: {
    get: vi.fn(),
    approve: vi.fn(),
    suspend: vi.fn(),
    reactivate: vi.fn(),
    reset2fa: vi.fn(),
    sendPasswordReset: vi.fn(),
    sendVerificationEmail: vi.fn(),
    update: vi.fn(),
    getConsents: vi.fn(),
    adjustBalance: vi.fn(),
    getUserRecords: vi.fn(),
    getUserCertificates: vi.fn(),
    getNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: {
    get: api.get,
    approve: api.approve,
    suspend: api.suspend,
    reactivate: api.reactivate,
    reset2fa: api.reset2fa,
    sendPasswordReset: api.sendPasswordReset,
    sendVerificationEmail: api.sendVerificationEmail,
    update: api.update,
    getConsents: api.getConsents,
  },
  adminTimebanking: { adjustBalance: api.adjustBalance },
  adminVetting: { getUserRecords: api.getUserRecords },
  adminInsurance: { getUserCertificates: api.getUserCertificates },
  adminCrm: {
    getNotes: api.getNotes,
    createNote: api.createNote,
    updateNote: api.updateNote,
    deleteNote: api.deleteNote,
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () => ({ useToast: () => mockToast }));

// Keep the real UI kit but make the confirm dialog answer deterministically.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return { ...orig, useConfirm: () => mockConfirm };
});

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, resolveAvatarUrl: (u: string | null) => u ?? null };
});
// Prefixed so a test can tell a date-only render from a date-time render.
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (s: string) => (s ? `date:${s}` : ''),
  formatServerDateTime: (s: string) => (s ? `datetime:${s}` : ''),
}));

// Passthrough i18n: return a readable label from the key's last segment so we
// can assert on button presence without depending on loaded translations.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // 🔴 Echo the KEY, never the defaultValue. Preferring defaultValue made every
    // key look missing, so a code with a real translation
    // (vetting.attestation_dbs_enhanced) rendered as the generic "other"
    // fallback — the suite asserted that fallback and so proved the opposite of
    // the lookup it meant to check. Every other assertion in this file already
    // expects a raw key, which is the i18n-independent thing to assert.
    t: (key: string) => key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import MemberDetailModal from './MemberDetailModal';

const activeMember = {
  id: 5,
  name: 'Dana Member',
  email: 'dana@example.com',
  role: 'member',
  status: 'active',
  email_verified_at: '2025-01-01T00:00:00Z',
  balance: 12,
  created_at: '2024-01-01T00:00:00Z',
  last_active_at: '2025-05-01T00:00:00Z',
  onboarding_completed: true,
  first_name: 'Dana',
  last_name: 'Member',
};

/** The modal is organised into tabs — switch to one by its accessible name. */
async function openTab(name: string | RegExp) {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.click(tab);
}

describe('MemberDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ success: true, data: activeMember });
    api.getUserRecords.mockResolvedValue({ success: true, data: [] });
    api.getUserCertificates.mockResolvedValue({ success: true, data: [] });
    api.getConsents.mockResolvedValue({ success: true, data: [] });
    api.getNotes.mockResolvedValue({ success: true, data: [] });
    api.adjustBalance.mockResolvedValue({ success: true });
    api.sendVerificationEmail.mockResolvedValue({ success: true });
    api.createNote.mockResolvedValue({ success: true });
    api.suspend.mockResolvedValue({ success: true });
    api.reactivate.mockResolvedValue({ success: true });
    api.deleteNote.mockResolvedValue({ success: true });
    mockConfirm.mockResolvedValue(true);
  });

  it('does not fetch when userId is null (modal closed)', () => {
    render(<MemberDetailModal userId={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the membership timeline on the default overview tab', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    // Timeline steps derived from fields the modal already loads.
    expect(screen.getByText('member_detail.timeline_registered')).toBeInTheDocument();
    expect(screen.getByText('member_detail.timeline_email_verified')).toBeInTheDocument();
    expect(screen.getByText('member_detail.timeline_approved')).toBeInTheDocument();
    // Overview facts
    expect(screen.getByText('member_detail.label_balance')).toBeInTheDocument();
    expect(screen.getByText('member_detail.label_onboarding')).toBeInTheDocument();
  });

  it('loads the member and shows the operational action set on the actions tab', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');

    // Sensitive/operational actions the broker should have.
    await waitFor(() => {
      expect(screen.getByText('member_detail.action_resend_verification')).toBeInTheDocument();
    });
    expect(screen.getByText('member_detail.action_send_password_reset')).toBeInTheDocument();
    expect(screen.getByText('member_detail.action_reset_2fa')).toBeInTheDocument();
    expect(screen.getByText('member_detail.action_adjust_balance')).toBeInTheDocument();
    // Active member → Suspend offered, not Approve/Reactivate.
    expect(screen.getByText('members.suspend')).toBeInTheDocument();
    // Safe profile edit lives here too.
    expect(screen.getByText('member_detail.edit_toggle')).toBeInTheDocument();
  });

  it('never exposes privileged actions (ban / delete / role change)', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    await waitFor(() => {
      expect(screen.getByText('member_detail.action_resend_verification')).toBeInTheDocument();
    });

    expect(screen.queryByText(/\bban\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bdelete\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/impersonate/i)).not.toBeInTheDocument();
  });

  it('shows compliance records on the compliance tab', async () => {
    api.getUserRecords.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        user_id: 5,
        scheme_code: 'dbs',
        attestation_code: 'dbs_enhanced',
        purpose_code: 'safeguarded_member_contact',
        scope_type: 'tenant',
        scope_identifier: '2',
        decision: 'confirmed',
        confirmed_at: '2026-07-10T09:00:00Z',
        revoked_at: null,
        revocation_reason_code: null,
        policy_version: 'ew-dbs-contact-v1',
      }],
    });

    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.tab_compliance');

    await waitFor(() => {
      expect(screen.getByText('member_detail.contact_attestations_title')).toBeInTheDocument();
    });
    // The attestation's own code is looked up (not the generic fallback), and the
    // decision reaches the status chip.
    expect(screen.getByText('vetting.attestation_dbs_enhanced')).toBeInTheDocument();
    expect(screen.getByText('status.confirmed')).toBeInTheDocument();
    expect(screen.getByText('member_detail.consents_title')).toBeInTheDocument();
  });

  it('lists notes and adds a new one from the notes tab', async () => {
    api.getNotes.mockResolvedValue({
      success: true,
      data: [{ id: 9, content: 'Existing broker note', category: 'general', is_pinned: false, created_at: '2025-05-01T09:00:00Z', author_name: 'Broker One' }],
    });

    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());
    await waitFor(() => expect(api.getNotes).toHaveBeenCalledWith({ user_id: 5, limit: 20 }));

    await openTab(/members\.notes/);

    await waitFor(() => {
      expect(screen.getByText('Existing broker note')).toBeInTheDocument();
    });
    expect(screen.getByText('Broker One')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('members.note_placeholder'), {
      target: { value: 'A fresh note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'members.send_note' }));

    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalledWith({
        user_id: 5,
        content: 'A fresh note',
        category: 'general',
      });
    });
  });

  it('adjusts the balance through the sub-modal', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    await waitFor(() => {
      expect(screen.getByText('member_detail.action_adjust_balance')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('member_detail.action_adjust_balance'));
    await waitFor(() => expect(screen.getByText('member_detail.balance_modal_title')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('member_detail.balance_reason_placeholder'), {
      target: { value: 'Manual correction' },
    });
    fireEvent.click(screen.getByText('member_detail.balance_submit'));

    await waitFor(() => expect(api.adjustBalance).toHaveBeenCalledWith(5, 5, 'Manual correction'));
  });

  // ─── Confirmations ─────────────────────────────────────────────────────────

  it('suspend asks for a danger confirmation and does nothing when cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    fireEvent.click(await screen.findByText('members.suspend'));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'members.confirm_suspend_title', status: 'danger' })
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.suspend).not.toHaveBeenCalled();
  });

  it('suspend runs after the broker confirms', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    fireEvent.click(await screen.findByText('members.suspend'));

    await waitFor(() => expect(api.suspend).toHaveBeenCalledWith(5));
  });

  it('reactivate asks for confirmation first (it emails the member)', async () => {
    mockConfirm.mockResolvedValue(false);
    api.get.mockResolvedValue({ success: true, data: { ...activeMember, status: 'suspended' } });
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    fireEvent.click(await screen.findByText('members.reactivate'));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'members.confirm_reactivate_title' })
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.reactivate).not.toHaveBeenCalled();
  });

  it('deleting a note asks for a danger confirmation first', async () => {
    mockConfirm.mockResolvedValue(false);
    api.getNotes.mockResolvedValue({
      success: true,
      data: [{ id: 9, content: 'Existing broker note', category: 'general', is_pinned: false, created_at: '2025-05-01T09:00:00Z', author_name: 'Broker One' }],
    });
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab(/members\.notes/);
    await screen.findByText('Existing broker note');
    fireEvent.click(screen.getByRole('button', { name: 'members.note_delete' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'members.confirm_note_delete_title', status: 'danger' })
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.deleteNote).not.toHaveBeenCalled();
  });

  // ─── Load failure ──────────────────────────────────────────────────────────

  it('shows an error with Retry when the member cannot be loaded, instead of a skeleton forever', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'));
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText('member_detail.load_error_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'member_detail.retry' }));

    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  // ─── Display details ───────────────────────────────────────────────────────

  it('uses a translated phone placeholder in the edit form', async () => {
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.section_actions');
    fireEvent.click(await screen.findByText('member_detail.edit_toggle'));

    expect(await screen.findByPlaceholderText('member_detail.edit_phone_placeholder')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+1 555 123 4567')).toBeNull();
  });

  it('shows insurance expiry as a date, not a date-time', async () => {
    api.getUserCertificates.mockResolvedValue({
      success: true,
      data: [{ id: 3, user_id: 5, insurance_type: 'public_liability', status: 'verified', expiry_date: '2027-03-01' }],
    });
    render(<MemberDetailModal userId={5} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dana Member')).toBeInTheDocument());

    await openTab('member_detail.tab_compliance');

    expect(await screen.findByText('date:2027-03-01')).toBeInTheDocument();
    expect(screen.queryByText('datetime:2027-03-01')).toBeNull();
  });
});
