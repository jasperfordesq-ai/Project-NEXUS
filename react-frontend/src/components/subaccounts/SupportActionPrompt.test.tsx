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
vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { SupportActionPrompt } from './SupportActionPrompt';

const mockedGet = vi.mocked(api.get);

describe('SupportActionPrompt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prompts the member when a prepared action awaits their answer', async () => {
    mockedGet.mockResolvedValue({ success: true, data: { actions: [], pending_count: 2 } } as never);

    render(<SupportActionPrompt />);

    await waitFor(() =>
      expect(screen.getByText(/only happens if you approve it/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Review and answer' })).toHaveAttribute(
      'href',
      '/test/settings?tab=linked-accounts',
    );
  });

  it('renders nothing when there is nothing pending', async () => {
    mockedGet.mockResolvedValue({ success: true, data: { actions: [], pending_count: 0 } } as never);

    const { container } = render(<SupportActionPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * 🔴 api.ts never throws, so an unsuccessful response arrives as
   * `{success:false}`. Without the explicit check that would read as "nothing
   * pending" — silently never appearing is the failure mode this component
   * exists to fix.
   */
  it('stays silent, not broken, when the request fails', async () => {
    mockedGet.mockResolvedValue({ success: false, error: 'nope' } as never);

    const { container } = render(<SupportActionPrompt />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
