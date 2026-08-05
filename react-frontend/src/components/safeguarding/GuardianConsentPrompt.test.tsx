// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  api: { get: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// No useTenant override: createMockContexts already supplies a type-valid
// tenant with tenantPath => `/test${path}`. Overriding it with a partial object
// is what tripped the test-type ratchet.
vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { GuardianConsentPrompt } from './GuardianConsentPrompt';

const mockedGet = vi.mocked(api.get);

describe('GuardianConsentPrompt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prompts the member when an arrangement awaits their answer', async () => {
    mockedGet.mockResolvedValue({ success: true, data: { pending_count: 1 } } as never);

    render(<GuardianConsentPrompt />);

    await waitFor(() =>
      expect(screen.getByText(/responsible for supporting you/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Review this' })).toHaveAttribute(
      'href',
      '/test/settings?tab=safeguarding',
    );
  });

  it('renders nothing when there is nothing pending', async () => {
    mockedGet.mockResolvedValue({ success: true, data: { pending_count: 0 } } as never);

    const { container } = render(<GuardianConsentPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * 🔴 api.ts never throws, so an unsuccessful response arrives as
   * `{success:false}`. Without an explicit check that reads as "nothing pending"
   * — the prompt would silently never appear, which is the exact failure mode
   * this component exists to fix.
   */
  it('stays silent, not broken, when the request fails', async () => {
    mockedGet.mockResolvedValue({ success: false, error: 'nope' } as never);

    const { container } = render(<GuardianConsentPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('does not prompt on a malformed count', async () => {
    mockedGet.mockResolvedValue({ success: true, data: {} } as never);

    const { container } = render(<GuardianConsentPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
