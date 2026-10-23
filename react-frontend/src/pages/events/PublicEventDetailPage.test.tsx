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

// PageMeta is a global no-op in tests; spy on it to see the sharing image.
vi.mock('@/components/seo', () => ({
  PageMeta: vi.fn(() => null),
  default: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '12' })),
  };
});

import { api } from '@/lib/api';
import { useParams } from 'react-router-dom';
import { PageMeta } from '@/components/seo';
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

/** The Event JSON-LD block (PageMeta also writes a BreadcrumbList block). */
function eventScript(): HTMLScriptElement | undefined {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))
    .find((s) => (s.textContent ?? '').includes('"@type":"Event"'));
}

function eventSchema(): ReturnType<typeof JSON.parse> {
  return JSON.parse(eventScript()?.textContent ?? '{}');
}

describe('PublicEventDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useParams).mockReturnValue({ id: '12' });
  });

  // E-104: the public page is unauthenticated and the description is
  // organiser-written, so the structured-data script must not be breakable.
  it('escapes "<" in the structured data so a description cannot close the script', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...DETAIL, description: 'Bring tools </script><script>alert(1)</script>' },
    });

    render(<PublicEventDetailPage />);
    await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

    await waitFor(() => {
      const script = eventScript();
      expect(script).toBeDefined();
      expect(script?.textContent ?? '').not.toContain('</script>');
      expect(script?.textContent ?? '').toContain('\\u003c/script');
    });
  });

  // E-104: the time must be the event's own, not the visitor's browser zone.
  it('shows the start time in the event time zone', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...DETAIL, start_time: '2026-12-14T18:00:00Z', timezone: 'Pacific/Auckland' },
    });

    render(<PublicEventDetailPage />);
    await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

    // 18:00 UTC on 14 December is 07:00 on 15 December in Auckland.
    expect(screen.getByText(/15 December 2026/)).toBeInTheDocument();
    expect(screen.getByText(/07:00/)).toBeInTheDocument();
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
      const parsed = eventSchema();
      expect(parsed['@type']).toBe('Event');
      expect(parsed.name).toBe('Wassail in the Orchard');
    });
  });

  // 2026-10-23 SEO audit: the Event block must pass Google's rich-result rules.
  describe('valid Event structured data', () => {
    it('gives dates with an offset, a status, an attendance mode, a Place and the community as organiser', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { ...DETAIL, attendance_mode: 'in_person', operational_status: 'scheduled', timezone: 'Europe/Paris' },
      });
      render(<PublicEventDetailPage />);
      await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

      await waitFor(() => expect(eventScript()).toBeDefined());
      const e = eventSchema();
      // 18:00 UTC is 19:00 in Paris in December.
      expect(e.startDate).toBe('2026-12-14T19:00:00+01:00');
      expect(e.endDate).toBe('2026-12-14T22:00:00+01:00');
      expect(e.eventStatus).toBe('https://schema.org/EventScheduled');
      expect(e.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
      expect(e.location).toEqual({ '@type': 'Place', name: 'Coventry Community Orchard', address: 'Coventry Community Orchard' });
      expect(e.organizer['@type']).toBe('Organization');
      expect(e.organizer.url).toMatch(/^https?:\/\/[^/]+\/test$/);
      expect(e.organizer.name).not.toBe('Marie');
      expect(e.url).toMatch(/^https?:\/\//);
      expect(e).not.toHaveProperty('image');
    });

    it('describes an online event with a VirtualLocation that has a url', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { ...DETAIL, attendance_mode: 'online', location: null },
      });
      render(<PublicEventDetailPage />);
      await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

      await waitFor(() => expect(eventScript()).toBeDefined());
      const e = eventSchema();
      expect(e.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
      expect(e.location['@type']).toBe('VirtualLocation');
      expect(e.location.url).toMatch(/^https?:\/\//);
      expect(e.location).not.toHaveProperty('name');
    });

    it('lists both places for a hybrid event', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { ...DETAIL, attendance_mode: 'hybrid' } });
      render(<PublicEventDetailPage />);
      await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

      await waitFor(() => expect(eventScript()).toBeDefined());
      const e = eventSchema();
      expect(e.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
      expect(e.location.map((l: { '@type': string }) => l['@type'])).toEqual(['Place', 'VirtualLocation']);
    });

    it('leaves out an unknown end date instead of emitting an empty one', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { ...DETAIL, end_time: null } });
      render(<PublicEventDetailPage />);
      await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

      await waitFor(() => expect(eventScript()).toBeDefined());
      expect(eventSchema()).not.toHaveProperty('endDate');
    });

    it("uses the event's own picture, as a full address, for the block and the sharing card", async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { ...DETAIL, image_url: '/uploads/tenants/test/events/wassail.jpg' },
      });
      render(<PublicEventDetailPage />);
      await screen.findByRole('heading', { name: 'Wassail in the Orchard' });

      await waitFor(() => expect(eventScript()).toBeDefined());
      const [image] = eventSchema().image as string[];
      expect(image).toMatch(/^https?:\/\/.+wassail\.jpg/);
      const lastProps = vi.mocked(PageMeta).mock.calls.slice(-1)[0]?.[0] as { image?: string } | undefined;
      expect(lastProps?.image).toBe(image);
    });
  });

  it('offers sign-in rather than a booking control', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: DETAIL });

    render(<PublicEventDetailPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
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
