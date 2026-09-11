// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TwoFactorSetupPage from './TwoFactorSetupPage';

const mocks = vi.hoisted(() => ({ post: vi.fn(), access: vi.fn(), refresh: vi.fn(), user: vi.fn(), cancel: vi.fn() }));
vi.mock('@/contexts', () => ({
  useAuth: () => ({ status: 'requires_2fa_setup', twoFactorToken: 'restricted-challenge',
    cancel2FA: mocks.cancel, refreshUser: mocks.user, scheduleSessionWarning: vi.fn() }),
  useTenant: () => ({ tenantPath: (path: string) => path }),
}));
vi.mock('@/lib/api', () => ({ api: { post: mocks.post }, tokenManager: { setAccessToken: mocks.access, setRefreshToken: mocks.refresh } }));

beforeEach(() => { vi.clearAllMocks(); });

it('keeps credentials out of storage until the recovery codes are acknowledged', async () => {
  mocks.post.mockResolvedValueOnce({ success: true, data: { qr_code_url: 'data:image/svg+xml;base64,abc', secret: 'manual-key' } });
  render(<MemoryRouter><TwoFactorSetupPage /></MemoryRouter>);
  const code = await screen.findByRole('textbox', { name: 'Six-digit verification code' });
  expect(screen.getByText('manual-key')).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledWith('/v2/auth/2fa/setup', { two_factor_token: 'restricted-challenge' }, { skipAuth: true });
  mocks.post.mockResolvedValueOnce({ success: true, data: { login_complete: true, backup_codes: ['recovery-one'], access_token: 'access', refresh_token: 'refresh', expires_in: 900 } });
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await screen.findByText('recovery-one');
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'I have saved my recovery codes' }));
  await waitFor(() => expect(mocks.user).toHaveBeenCalled());
  expect(mocks.access).toHaveBeenCalledWith('access');
  expect(mocks.refresh).toHaveBeenCalledWith('refresh');
});

it('preserves the scanned key and allows retry after a rejected verification', async () => {
  mocks.post.mockResolvedValueOnce({ success: true, data: { qr_code_url: 'data:image/svg+xml;base64,abc', secret: 'same-key' } });
  render(<MemoryRouter><TwoFactorSetupPage /></MemoryRouter>);
  const code = await screen.findByRole('textbox', { name: 'Six-digit verification code' });
  mocks.post.mockResolvedValueOnce({ success: false, error: 'Invalid verification code' });
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await screen.findByRole('alert');
  expect(screen.getByText('same-key')).toBeInTheDocument();
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
