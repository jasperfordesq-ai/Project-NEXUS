// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { currentAnnouncement, safeAnnouncementLink } from '@/lib/siteAnnouncement';
import { SiteAnnouncementBanner } from './SiteAnnouncementBanner';

const tenantState = vi.hoisted(() => ({ announcement: null as unknown }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Riverside', slug: 'riverside', announcement: tenantState.announcement },
    tenantPath: (p: string) => `/riverside${p}`,
  }),
}));

const NOW = Date.parse('2026-11-12T10:00:00Z');
const base = {
  id: 7,
  message: 'Repair café this Saturday in the hall',
  style: 'info',
  link_url: null,
  link_label: null,
  is_dismissible: true,
  starts_at: null,
  ends_at: null,
  updated_at: '2026-11-12T09:00:00+00:00',
};

function show(announcement: unknown) {
  tenantState.announcement = announcement;
  return render(
    <MemoryRouter>
      <SiteAnnouncementBanner />
    </MemoryRouter>,
  );
}

describe('the notice a community shows', () => {
  it('is nothing when there is none, or it is not a notice at all', () => {
    expect(currentAnnouncement(null, NOW)).toBeNull();
    expect(currentAnnouncement('hello', NOW)).toBeNull();
    expect(currentAnnouncement({ ...base, message: '   ' }, NOW)).toBeNull();
    expect(currentAnnouncement({ ...base, id: 0 }, NOW)).toBeNull();
  });

  // The bootstrap is cached for up to ten minutes (and by browsers), so the
  // website checks the dates itself.
  it('is not shown before it starts or once it has ended, whatever a cached copy says', () => {
    expect(currentAnnouncement({ ...base, starts_at: '2026-11-12T10:00:01Z' }, NOW)).toBeNull();
    expect(currentAnnouncement({ ...base, ends_at: '2026-11-12T10:00:00Z' }, NOW)).toBeNull();
    expect(currentAnnouncement({ ...base, starts_at: '2026-11-12T09:00:00Z', ends_at: '2026-11-12T11:00:00Z' }, NOW)).not.toBeNull();
    expect(currentAnnouncement({ ...base, ends_at: 'not a date' }, NOW)).toBeNull();
  });

  it('only ever uses one of our own styles', () => {
    expect(currentAnnouncement({ ...base, style: 'celebration' }, NOW)?.style).toBe('celebration');
    expect(currentAnnouncement({ ...base, style: 'important' }, NOW)?.style).toBe('important');
    expect(currentAnnouncement({ ...base, style: '"><script>' }, NOW)?.style).toBe('info');
  });

  it('accepts a path inside the site or an https address, and nothing else, as a link', () => {
    expect(safeAnnouncementLink('/events/12')).toEqual({ url: '/events/12', internal: true });
    expect(safeAnnouncementLink('https://example.org/news')).toEqual({ url: 'https://example.org/news', internal: false });
    for (const bad of [
      'javascript:alert(1)', 'data:text/html,x', '//evil.example', 'http://example.org',
      '/\\evil.example', 'https://good.example@evil.example/', ' https://x.example y', '', null, 42,
    ]) {
      expect(safeAnnouncementLink(bad), String(bad)).toBeNull();
    }
    // An unsafe link is dropped; the words are still shown.
    const shown = currentAnnouncement({ ...base, link_url: 'javascript:alert(1)', link_label: 'Click' }, NOW);
    expect(shown?.message).toBe(base.message);
    expect(shown?.linkUrl).toBeNull();
    expect(shown?.linkLabel).toBeNull();
  });
});

describe('SiteAnnouncementBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/riverside/dashboard');
  });

  // The website is one page that stays open: a member who opened it before a
  // notice's end time must not keep seeing the notice after it, until they
  // happen to reload (audit of warmth phase 5, 12 Nov 2026).
  it('goes away at its end time while the page stays open', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      show({ ...base, ends_at: '2026-11-12T10:05:00Z' });
      expect(screen.getByTestId('site-announcement')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4 * 60 * 1000);
      });
      expect(screen.getByTestId('site-announcement')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(61 * 1000);
      });
      expect(screen.queryByTestId('site-announcement')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders nothing when the community has no notice', () => {
    const { container } = show(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the words as plain text in a labelled region, without taking focus', () => {
    show({ ...base, message: '<b>Hello</b> neighbours' });
    const region = screen.getByRole('region', { name: 'announcement_region_label' });
    // Text, never markup: the tags are shown as characters.
    expect(region).toHaveTextContent('<b>Hello</b> neighbours');
    expect(region.querySelector('b')).toBeNull();
    expect(region).not.toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(document.body);
  });

  it('links inside the site through the community address, and outside in a new tab', () => {
    const { unmount } = show({ ...base, link_url: '/events/12', link_label: 'See the event' });
    expect(screen.getByRole('link', { name: 'See the event' })).toHaveAttribute('href', '/riverside/events/12');
    unmount();

    show({ ...base, link_url: 'https://example.org/news', link_label: 'Read more' });
    const link = screen.getByRole('link', { name: /Read more/ });
    expect(link).toHaveAttribute('href', 'https://example.org/news');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  // Closing it removes the button that had the keyboard focus. Focus then
  // fell to the top of the document; it now goes to the page's main area,
  // where the banner was (audit of warmth phase 5, 12 Nov 2026).
  it('keeps a keyboard user in the page when it is closed', () => {
    tenantState.announcement = base;
    render(
      <MemoryRouter>
        <main id="main-content" tabIndex={-1}>
          <SiteAnnouncementBanner />
          <p>Page content</p>
        </main>
      </MemoryRouter>,
    );
    const close = screen.getByRole('button', { name: 'announcement_dismiss' });
    close.focus();
    fireEvent.click(close);

    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('can be closed, and stays closed on this device until the notice is changed', () => {
    const { unmount } = show(base);
    fireEvent.click(screen.getByRole('button', { name: 'announcement_dismiss' }));
    expect(screen.queryByRole('region')).toBeNull();
    unmount();

    const again = show(base);
    expect(screen.queryByRole('region')).toBeNull();
    again.unmount();

    // The admin edits it: it is a new notice to the member.
    show({ ...base, updated_at: '2026-11-12T09:30:00+00:00' });
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('has no close button when the admin made it stay', () => {
    show({ ...base, is_dismissible: false });
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'announcement_dismiss' })).toBeNull();
  });

  it('paints only with colours that are readable: the button shade, or the warning pair', () => {
    const { unmount } = show(base);
    expect(screen.getByRole('region').className).toContain('bg-accent-strong');
    expect(screen.getByRole('region').className).toContain('text-white');
    unmount();
    show({ ...base, style: 'important' });
    expect(screen.getByRole('region').className).toContain('bg-amber-100');
    expect(screen.getByRole('region').className).toContain('text-amber-900');
  });

  it('is left out of the pages prepared for search engines', () => {
    window.history.replaceState({}, '', '/riverside/about?nexus_prerender_bypass=1');
    const { container } = show(base);
    expect(container).toBeEmptyDOMElement();
  });
});
