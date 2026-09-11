// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorRecovery } from './TwoFactorRecovery';
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { post } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('TwoFactorRecovery', () => {
  beforeEach(() => post.mockReset());
  it('retains replacement codes until explicit acknowledgment', async () => {
    post.mockResolvedValue({ success: true, data: { backup_codes: ['ABCD-1234'] } });
    render(<TwoFactorRecovery />);
    fireEvent.change(screen.getByLabelText('mfa_recovery.code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'mfa_recovery.replace' }));
    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/v2/auth/2fa/recovery-codes', { code: '123456' });
    fireEvent.click(screen.getByRole('button', { name: 'mfa_recovery.saved' }));
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
  });
  it('shows failure without claiming codes were replaced and allows retry', async () => {
    post.mockResolvedValue({ success: false });
    render(<TwoFactorRecovery />);
    fireEvent.change(screen.getByLabelText('mfa_recovery.code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'mfa_recovery.replace' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('mfa_recovery.failed'));
    expect(screen.getByLabelText('mfa_recovery.code')).toHaveValue('123456');
  });
});
