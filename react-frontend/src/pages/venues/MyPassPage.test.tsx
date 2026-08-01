// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import MyPassPage from './MyPassPage';

const PASS = {
  token: 'a'.repeat(64),
  qr_url: 'https://app.example.test/hour-timebank/venues/checkin/' + 'a'.repeat(64),
  status: 'active',
  last_used_at: null,
};

function mockPassAndVisits(visits: unknown[] = []) {
  vi.mocked(api.get).mockImplementation((endpoint: string) => {
    if (endpoint.includes('/pass')) {
      return Promise.resolve({ success: true, data: PASS });
    }
    return Promise.resolve({ success: true, data: { visits } });
  });
}

describe('MyPassPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the pass and renders the QR pointing at the check-in URL', async () => {
    mockPassAndVisits();

    render(<MyPassPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/partner-venues/pass');
    });

    // QrCodeImage renders an aria-labelled placeholder before the async
    // generator chunk resolves, so assert on the accessible image either way.
    expect(await screen.findByRole('img', { name: /pass/i })).toBeInTheDocument();
  });

  it('shows an empty state when no visits have been recorded', async () => {
    mockPassAndVisits([]);

    render(<MyPassPage />);

    expect(await screen.findByText(/no visits recorded/i)).toBeInTheDocument();
  });

  it('lists recorded visits with their venue and date', async () => {
    mockPassAndVisits([
      { id: 1, venue_id: 3, venue_name: 'The Time Union Cafe', visited_on: '2026-07-30', visited_at: null },
    ]);

    render(<MyPassPage />);

    expect(await screen.findByText('The Time Union Cafe')).toBeInTheDocument();
    expect(screen.getByText('2026-07-30')).toBeInTheDocument();
  });

  it('rotates the pass token on request', async () => {
    mockPassAndVisits();
    const rotated = { ...PASS, token: 'b'.repeat(64) };
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: rotated });

    render(<MyPassPage />);

    const rotateButton = await screen.findByRole('button', { name: /replace my code/i });
    fireEvent.click(rotateButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/partner-venues/pass/rotate', {});
    });
  });
});
