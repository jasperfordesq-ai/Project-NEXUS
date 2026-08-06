// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

// Mock react-router-dom, preserving real exports but overriding useParams —
// test-utils wraps in BrowserRouter, so route params can't come from the URL.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ token: 'tok123' })),
  };
});

import { api } from '@/lib/api';
import { useParams } from 'react-router-dom';
import SupportActionConfirmPage from './SupportActionConfirmPage';

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);

function renderAtToken() {
  vi.mocked(useParams).mockReturnValue({ token: 'tok123' });
  return render(<SupportActionConfirmPage />);
}

describe('SupportActionConfirmPage', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * 🔴 The load is READ-ONLY. Mail scanners prefetch links; approval must be
   * a human act. Opening the page must call the GET lookup and never the
   * confirming POST.
   */
  it('looks up the token on load and does NOT confirm', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: { action_type: 'credit_transfer', status: 'pending', supporter_name: 'Carer Smith', expires_at: null },
    } as never);

    renderAtToken();

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/v2/support-actions/confirm/tok123', { skipAuth: true }),
    );
    expect(screen.getByText(/Carer Smith/)).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('confirms only on the explicit button press', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: { action_type: 'listing_create', status: 'pending', supporter_name: 'Carer Smith', expires_at: null },
    } as never);
    mockedPost.mockResolvedValue({ success: true, data: { status: 'confirmed', result_id: 5 } } as never);

    renderAtToken();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve it' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/v2/support-actions/confirm/tok123', undefined, { skipAuth: true }),
    );
    expect(await screen.findByText('Done')).toBeInTheDocument();
  });

  it('shows already-answered state without offering the button', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: { action_type: 'credit_transfer', status: 'confirmed', supporter_name: 'Carer Smith', expires_at: null },
    } as never);

    renderAtToken();

    expect(await screen.findByText('Already answered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve it' })).not.toBeInTheDocument();
  });
});
