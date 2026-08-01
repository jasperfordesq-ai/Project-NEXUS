// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
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
import PublicEventsListPage from './PublicEventsListPage';

const EVENT = {
  id: 12,
  title: 'Wassail in the Orchard',
  start_time: '2026-12-14T18:00:00Z',
  end_time: '2026-12-14T21:00:00Z',
  timezone: 'Europe/London',
  all_day: false,
  location: 'Coventry Community Orchard',
  latitude: null,
  longitude: null,
  is_online: false,
  image_url: null,
  category: { id: 3, name: 'Celebration', slug: 'celebration', color: null },
  organizer_name: 'Marie',
};

describe('PublicEventsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the public endpoint, not the member events endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [EVENT] });

    render(<PublicEventsListPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/public/events');
    });
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/events/));
  });

  it('renders an event with its venue and host', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [EVENT] });

    render(<PublicEventsListPage />);

    expect(await screen.findByText('Wassail in the Orchard')).toBeInTheDocument();
    expect(screen.getByText('Coventry Community Orchard')).toBeInTheDocument();
    expect(screen.getByText(/Marie/)).toBeInTheDocument();
  });

  it('links each event to its public detail page, not the member one', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [EVENT] });

    render(<PublicEventsListPage />);

    const link = await screen.findByRole('link', { name: 'Wassail in the Orchard' });
    expect(link.getAttribute('href')).toContain('/whats-on/12');
    expect(link.getAttribute('href')).not.toContain('/events/12');
  });

  it('offers a sign-in call to action rather than any booking control', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [EVENT] });

    render(<PublicEventsListPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /going|rsvp|book/i })).not.toBeInTheDocument();
  });

  it('shows an empty state rather than an error when nothing is listed', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });

    render(<PublicEventsListPage />);

    expect(await screen.findByText(/no upcoming events/i)).toBeInTheDocument();
  });

  it('does not crash when the endpoint fails', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'boom' });

    render(<PublicEventsListPage />);

    expect(await screen.findByText(/no upcoming events/i)).toBeInTheDocument();
  });
});
