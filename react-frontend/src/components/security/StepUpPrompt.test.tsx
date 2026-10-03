// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Handler = () => Promise<{ token: string; expiresIn: number } | null>;
let registered: Handler | null = null;

vi.mock('@/lib/api', () => ({
  setStepUpHandler: (handler: Handler | null) => {
    registered = handler;
  },
}));

const mockConfirm = vi.fn();
const mockStatus = vi.fn();
vi.mock('@/lib/webauthn', () => ({
  confirmWebAuthnSecurity: (...args: unknown[]) => mockConfirm(...args),
  getWebAuthnStatus: (...args: unknown[]) => mockStatus(...args),
}));

import { StepUpPrompt } from './StepUpPrompt';

describe('StepUpPrompt', () => {
  beforeEach(() => {
    registered = null;
    mockConfirm.mockReset();
    mockStatus.mockReset();
    mockStatus.mockResolvedValue({ registered: false, count: 0, confirmation_methods: { password: true, totp: true } });
  });

  it('registers with the API client and unregisters on unmount', () => {
    const { unmount } = render(<StepUpPrompt />);
    expect(registered).not.toBeNull();
    unmount();
    expect(registered).toBeNull();
  });

  it('confirms with an authenticator code and hands the token back', async () => {
    mockConfirm.mockResolvedValue({ success: true, securityConfirmationToken: 'proof', expiresIn: 300 });
    render(<StepUpPrompt />);

    let pending: ReturnType<Handler> | undefined;
    act(() => {
      pending = registered?.();
    });
    const input = await screen.findByRole('textbox');
    // A password alone is not a second factor: it is never offered.
    expect(screen.queryByRole('button', { name: /current password/i })).toBeNull();

    await userEvent.type(input, '123 456');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await expect(pending).resolves.toEqual({ token: 'proof', expiresIn: 300 });
    expect(mockConfirm).toHaveBeenCalledWith({ totp_code: '123456' });
  });

  it('keeps the prompt open with an error when the code is refused', async () => {
    mockConfirm.mockResolvedValue({ success: false, errorCode: 'SECURITY_CONFIRMATION_REQUIRED' });
    render(<StepUpPrompt />);
    act(() => {
      void registered?.();
    });
    await userEvent.type(await screen.findByRole('textbox'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true'));
  });

  it('resolves with nothing when cancelled', async () => {
    render(<StepUpPrompt />);
    let pending: ReturnType<Handler> | undefined;
    act(() => {
      pending = registered?.();
    });
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    await expect(pending).resolves.toBeNull();
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
