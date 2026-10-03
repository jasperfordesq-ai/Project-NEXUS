// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Actions tab, the profile editor and the balance modal — extracted from
 * MemberDetailModal, so these pin the behaviour the modal's own tests relied
 * on: confirmations before suspend / reactivate, the 2FA reason gate, the
 * balance validation, and the safe-field-only profile save.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const { api, mockConfirm, mockToast } = vi.hoisted(() => ({
  api: {
    approve: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), reset2fa: vi.fn(),
    sendPasswordReset: vi.fn(), sendVerificationEmail: vi.fn(), update: vi.fn(), adjustBalance: vi.fn(),
  },
  mockConfirm: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: {
    approve: api.approve, suspend: api.suspend, reactivate: api.reactivate, reset2fa: api.reset2fa,
    sendPasswordReset: api.sendPasswordReset, sendVerificationEmail: api.sendVerificationEmail, update: api.update,
  },
  adminTimebanking: { adjustBalance: api.adjustBalance },
}));
vi.mock('@/contexts', () => ({ useToast: () => mockToast }));
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return { ...orig, useConfirm: () => mockConfirm };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { MemberActionsTab } from './MemberActionsTab';
import type { AdminUserDetail } from '@/admin/api/types';

const member = {
  id: 5, name: 'Dana Member', email: 'dana@example.com', role: 'member', status: 'active',
  first_name: 'Dana', last_name: 'Member', balance: 12, created_at: '2024-01-01', has_2fa_enabled: false, is_super_admin: false, badges: [],
} as unknown as AdminUserDetail;

describe('MemberActionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(api).forEach((fn) => fn.mockResolvedValue({ success: true }));
    mockConfirm.mockResolvedValue(true);
  });

  it('shows the operational set for an active member and never the privileged ones', () => {
    render(<MemberActionsTab detail={member} onChanged={vi.fn()} reload={vi.fn(async () => undefined)} />);
    expect(screen.getByRole('button', { name: /members\.suspend/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /action_resend_verification/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /action_send_password_reset/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /action_adjust_balance/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /members\.approve/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/ban|delete|role/i)).not.toBeInTheDocument();
  });

  it('suspend asks a danger confirmation and does nothing on "no"', async () => {
    mockConfirm.mockResolvedValue(false);
    render(<MemberActionsTab detail={member} onChanged={vi.fn()} reload={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: /members\.suspend/ }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ status: 'danger' })));
    expect(api.suspend).not.toHaveBeenCalled();
  });

  it('a successful action toasts, tells the parent, and reloads the member', async () => {
    const onChanged = vi.fn();
    const reload = vi.fn(async () => undefined);
    render(<MemberActionsTab detail={member} onChanged={onChanged} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: /members\.suspend/ }));
    await waitFor(() => expect(api.suspend).toHaveBeenCalledWith(5));
    expect(mockToast.success).toHaveBeenCalledWith('member_detail.suspend_success');
    expect(onChanged).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('e-mail actions do not reload the member (nothing about them changed)', async () => {
    const reload = vi.fn(async () => undefined);
    render(<MemberActionsTab detail={member} onChanged={vi.fn()} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: /action_resend_verification/ }));
    await waitFor(() => expect(api.sendVerificationEmail).toHaveBeenCalledWith(5));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reset 2FA stays disabled until a 10-character reason is given, then sends it', async () => {
    render(<MemberActionsTab detail={member} onChanged={vi.fn()} reload={vi.fn(async () => undefined)} />);
    const button = screen.getByRole('button', { name: /action_reset_2fa/ });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('member_detail.reset_2fa_reason_label'), { target: { value: 'INC-123 verified by phone' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.reset2fa).toHaveBeenCalledWith(5, 'INC-123 verified by phone'));
  });

  it('balance: rejects zero and a missing reason, then applies the adjustment', async () => {
    const onChanged = vi.fn();
    render(<MemberActionsTab detail={member} onChanged={onChanged} reload={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: /action_adjust_balance/ }));
    const dialog = await screen.findByRole('dialog');
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'member_detail.balance_submit' }));

    submit();
    expect(mockToast.error).toHaveBeenCalledWith('member_detail.balance_amount_invalid');
    fireEvent.change(screen.getByLabelText('member_detail.balance_amount_label'), { target: { value: '-3' } });
    submit();
    expect(mockToast.error).toHaveBeenCalledWith('member_detail.balance_reason_required');
    fireEvent.change(screen.getByLabelText(/member_detail\.balance_reason_label/), { target: { value: 'Correcting a double entry' } });
    submit();

    await waitFor(() => expect(api.adjustBalance).toHaveBeenCalledWith(5, -3, 'Correcting a double entry'));
    expect(mockToast.success).toHaveBeenCalledWith('member_detail.balance_success');
    expect(onChanged).toHaveBeenCalled();
    expect(dialog).toBeTruthy();
  });

  it('profile editor saves only the safe fields, trimmed', async () => {
    render(<MemberActionsTab detail={member} onChanged={vi.fn()} reload={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: /edit_toggle/ }));
    fireEvent.change(screen.getByLabelText('member_detail.edit_phone'), { target: { value: ' +1 555 000 1111 ' } });
    expect(screen.getByPlaceholderText('member_detail.edit_phone_placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'member_detail.edit_save' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith(5, {
      first_name: 'Dana', last_name: 'Member', phone: '+1 555 000 1111', bio: '', tagline: '', location: '',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('member_detail.edit_success');
  });
});
