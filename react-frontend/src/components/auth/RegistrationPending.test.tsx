// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "check your email" screen shown straight after Create Account
 * (B1 walk 2.12, 13 Nov 2026). It used to offer only "Go to sign in", which
 * cannot work yet, with no way to send the link again and no way out of a
 * mistyped address.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/test-utils';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { post: apiMocks.post } }));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', settings: {} },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

import { RegistrationPending } from './RegistrationPending';

const verifyAndApprove = { success: true, requiresVerification: true, requiresApproval: true };

function renderPending(overrides: Partial<Parameters<typeof RegistrationPending>[0]> = {}) {
  const onStartAgain = vi.fn();
  const utils = render(
    <RegistrationPending
      result={verifyAndApprove}
      firstName="Nora"
      email="nora@example.org"
      loginLink="/test/login"
      onStartAgain={onStartAgain}
      {...overrides}
    />,
  );
  return { ...utils, onStartAgain };
}

describe('RegistrationPending — check your email', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    vi.useRealTimers();
  });

  it('thanks the member by first name and shows the address the link went to', () => {
    renderPending();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nora');
    expect(screen.getByText('nora@example.org')).toBeInTheDocument();
    expect(screen.getByTestId('community-welcome')).toBeInTheDocument();
  });

  it('sends the link again through the enumeration-safe endpoint and says so neutrally', async () => {
    apiMocks.post.mockResolvedValue({ success: true, data: { message: 'generic' } });
    renderPending({ returnTo: '/test/groups/7' });

    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/auth/resend-verification-by-email',
        { email: 'nora@example.org', return_to: '/test/groups/7' },
        { skipAuth: true },
      ),
    );
    const note = await screen.findByRole('status');
    // Neutral: it never says the address exists or is unverified.
    expect(note).toHaveTextContent(/if that address still needs verifying/i);
    // And the button rests for a while so it cannot be hammered.
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeDisabled();
  });

  it('lets the member ask again after a short wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMocks.post.mockResolvedValue({ success: true, data: {} });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send it again' })).toBeDisabled());

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: 'Send it again' })).not.toBeDisabled();
  });

  it('explains a refusal for asking too often without saying anything about the address', async () => {
    apiMocks.post.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many' });
    renderPending();

    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    expect(await screen.findByText(/you've asked a few times/i)).toBeInTheDocument();
  });

  it('offers a way back to the form for a mistyped address', () => {
    const { onStartAgain } = renderPending();
    expect(screen.getByText('Wrong address?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onStartAgain).toHaveBeenCalledTimes(1);
  });

  it('keeps "Back to sign in" as a quieter way out, not the main button', () => {
    renderPending();
    const back = screen.getByRole('link', { name: 'Back to sign in' });
    expect(back.getAttribute('href')).toBe('/test/login');
    expect(screen.queryByRole('button', { name: 'Go to sign in' })).toBeNull();
  });

  it('uses theme text colours that keep their contrast, not blue-on-blue or amber-on-amber', () => {
    const { container } = renderPending();
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-blue-\d|text-amber-\d/);
  });

  it('offers no resend or start-again when no email check is needed', () => {
    renderPending({ result: { success: true, requiresApproval: true } });
    expect(screen.queryByRole('button', { name: 'Send it again' })).toBeNull();
    expect(screen.queryByText('Wrong address?')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});
