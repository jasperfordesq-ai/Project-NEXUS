// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TwoFactorSetupPage from './TwoFactorSetupPage';

const mocks = vi.hoisted(() => ({ post: vi.fn(), access: vi.fn(), refresh: vi.fn(), user: vi.fn(), cancel: vi.fn() }));
// The page imports the context hooks from their direct modules (bundle-budget rule
// for auth startup surfaces), so the mocks must target those modules, not the barrel.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ status: 'requires_2fa_setup', twoFactorToken: 'restricted-challenge',
    cancel2FA: mocks.cancel, refreshUser: mocks.user, scheduleSessionWarning: vi.fn() }),
}));
vi.mock('@/contexts/TenantContext', () => ({
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

// Two-factor security review (E-004): cancelling forgets the challenge, and an
// expired challenge never leaves a credential behind.
it('forgets the challenge on cancel and stores nothing when the challenge has expired', async () => {
  mocks.post.mockResolvedValueOnce({ success: true, data: { qr_code_url: 'data:image/svg+xml;base64,abc', secret: 'expiring-key' } });
  render(<MemoryRouter><TwoFactorSetupPage /></MemoryRouter>);
  const code = await screen.findByRole('textbox', { name: 'Six-digit verification code' });
  mocks.post.mockResolvedValueOnce({ success: false, code: 'AUTH_2FA_TOKEN_EXPIRED', error: 'Your session expired' });
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await screen.findByRole('alert');
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.user).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Return to sign in' }));
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
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

// Recovery codes are shown exactly once, so the enrolment screen is the only place a
// member can keep them. Until 12 September 2026 it printed them with no way to do so.
async function reachRecoveryCodes(codes: [string, ...string[]] = ['recovery-one', 'recovery-two']) {
  mocks.post.mockResolvedValueOnce({ success: true, data: { qr_code_url: 'data:image/svg+xml;base64,abc', secret: 'manual-key' } });
  render(<MemoryRouter><TwoFactorSetupPage /></MemoryRouter>);
  const code = await screen.findByRole('textbox', { name: 'Six-digit verification code' });
  mocks.post.mockResolvedValueOnce({ success: true, data: { login_complete: true, backup_codes: codes, access_token: 'access', refresh_token: 'refresh', expires_in: 900 } });
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await screen.findByText(codes[0]);
}

it('warns that the codes are shown only once', async () => {
  await reachRecoveryCodes();
  expect(screen.getByText('These codes are shown once. You will not see them again.')).toBeInTheDocument();
});

it('saves the codes to a text file built in memory, without any request', async () => {
  // jsdom's Blob has no .text(), so capture what the file is built from instead —
  // which is also the thing worth asserting on: the bytes never leave the page.
  const written: string[] = [];
  const types: string[] = [];
  vi.stubGlobal('Blob', class {
    constructor(chunks: string[], options: { type?: string } = {}) {
      written.push(chunks.join(''));
      types.push(options.type ?? '');
    }
  });
  const created: unknown[] = [];
  const revoked: string[] = [];
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: (blob: unknown) => { created.push(blob); return 'blob:test/1'; },
    revokeObjectURL: (url: string) => { revoked.push(url); },
  }));
  const clicks: string[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = realCreate(tag) as HTMLElement;
    if (tag === 'a') element.click = () => { clicks.push((element as HTMLAnchorElement).download); };
    return element;
  });

  await reachRecoveryCodes();
  const postCallsBefore = mocks.post.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Download as a text file' }));

  expect(created).toHaveLength(1);
  expect(written).toHaveLength(1);
  expect(types[0]).toBe('text/plain;charset=utf-8');
  expect(written[0]).toContain('recovery-one');
  expect(written[0]).toContain('recovery-two');
  expect(written[0]).toContain('Two-factor recovery codes');
  expect(clicks[0]).toMatch(/^recovery-codes-\d{4}-\d{2}-\d{2}\.txt$/);
  expect(revoked).toEqual(['blob:test/1']);
  // The codes never leave the page: no extra API call was made to produce the file.
  expect(mocks.post.mock.calls).toHaveLength(postCallsBefore);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('copies the codes and says so, without logging them', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  await reachRecoveryCodes();
  fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith('recovery-one\nrecovery-two'));
  await screen.findByRole('button', { name: 'Codes copied' });
  expect(errors).not.toHaveBeenCalled();
  expect(logs).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('explains a failed copy on screen rather than silently doing nothing', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true,
  });
  await reachRecoveryCodes();
  fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));
  expect(await screen.findByText('The codes could not be copied. Select them and copy them by hand.')).toBeInTheDocument();
});
