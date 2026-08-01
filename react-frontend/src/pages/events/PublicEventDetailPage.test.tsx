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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '12' })),
  };
});

import { api } from '@/lib/api';
import { useParams } from 'react-router-dom';
import PublicEventDetailPage from './PublicEventDetailPage';

const DETAIL = {
  id: 12,
  title: 'Wassail in the Orchard',
  description: 'A midwinter community celebration.',
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
  accessibility: {
    step_free: true,
    accessible_toilet: true,
    hearing_loop: false,
    quiet_space: null,
    seating: true,
    parking: null,
    notes: 'Uneven ground near the far hedge.',
  },
};

describe('PublicEventDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useParams).mockReturnValue({ id: '12' });
  });

  it('reads the public detail endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/public/events/12');
    });
  });

  it('renders the event and its description', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Wassail in the Orchard' })).toBeInTheDocument();
    expect(screen.getByText('A midwinter community celebration.')).toBeInTheDocument();
  });

  it('publishes only the accessibility features the venue actually has', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    expect(await screen.findByText('Step-free access')).toBeInTheDocument();
    expect(screen.getByText('Accessible toilet')).toBeInTheDocument();
    expect(screen.getByText('Seating available')).toBeInTheDocument();
    // false and null must not be advertised as available.
    expect(screen.queryByText('Hearing loop')).not.toBeInTheDocument();
    expect(screen.queryByText('Accessible parking')).not.toBeInTheDocument();
    expect(screen.getByText(/Uneven ground/)).toBeInTheDocument();
  });

  it('emits schema.org Event JSON-LD for rich results', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

    await waitFor(() => {
      const script = document.querySelector('script[type="application/ld+json"]');
      expect(script).not.toBeNull();
      const parsed = JSON.parse(script?.textContent ?? '{}');
      expect(parsed['@type']).toBe('Event');
      expect(parsed.name).toBe('Wassail in the Orchard');
    });
  });

  it('offers sign-in rather than a booking control', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /going|rsvp|book/i })).not.toBeInTheDocument();
  });

  it('shows a neutral not-available message when the event is not public', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, errors: [{ code: 'NOT_FOUND' }] });

    render(<PublicEventDetailPage />);

    // Deliberately does not distinguish "deleted" from "members only" — the
    // API returns the same 404 for both so the page cannot leak existence.
    expect(await screen.findByText(/Event not available/i)).toBeInTheDocument();
  });
});
