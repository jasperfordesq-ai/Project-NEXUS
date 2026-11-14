// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AboutPage — the community's own page (14 Nov 2026).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import contributors from '@/data/contributors.json';
import { PROJECT_NEXUS_REPO_URL } from '@/config/externalLinks';

// What the community has told us about itself, and who is looking, change per test.
const state = vi.hoisted(() => ({
  description: undefined as string | undefined,
  contact: undefined as Record<string, string> | undefined,
  stats: { members: 31, hours_exchanged: 443, listings: 20, skills: 0, communities: 1 } as Record<string, number>,
  statsFail: false,
  isAuthenticated: false,
  isLoading: false,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(() =>
      state.statsFail
        ? Promise.resolve({ success: false })
        : Promise.resolve({ success: true, data: state.stats })
    ),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () =>
  // Only the fields this page reads; the helper's own types want every field
  // of the real contexts.
  createMockContexts({
    useTenant: (() => ({
      tenant: { id: 2, name: 'Test', slug: 'test', description: state.description, contact: state.contact },
      branding: { name: 'Test Timebank' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: () => true,
      hasModule: () => true,
    })) as never,
    useAuth: (() => ({
      user: state.isAuthenticated ? { id: 7, first_name: 'Maeve' } : null,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
    })) as never,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

async function renderPage() {
  const { AboutPage } = await import('./AboutPage');
  return render(<AboutPage />);
}

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

describe('AboutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.description = undefined;
    state.contact = undefined;
    state.stats = { members: 31, hours_exchanged: 443, listings: 20, skills: 0, communities: 1 };
    state.statsFail = false;
    state.isAuthenticated = false;
    state.isLoading = false;
  });

  // ── The opening ────────────────────────────────────────────────────────────

  it('opens with one heading that names the community', async () => {
    await renderPage();
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe('About Test Timebank');
  });

  // Admin → Community settings → "Short description" was saved but shown to no
  // member until this page used it.
  it("opens with the community's own words when it has written some", async () => {
    state.description = '  Neighbours in Riverside sharing time and skills.  ';
    await renderPage();
    expect(screen.getByText('Neighbours in Riverside sharing time and skills.')).toBeInTheDocument();
    expect(screen.queryByText(/is neighbours sharing time and skills/)).toBeNull();
  });

  it('opens with the standard sentence when the community has written nothing', async () => {
    state.description = '   ';
    await renderPage();
    expect(
      screen.getByText('Test Timebank is neighbours sharing time and skills. Give an hour of help, and get an hour back.')
    ).toBeInTheDocument();
  });

  it('invites a signed-out visitor to join, and not a signed-in member', async () => {
    await renderPage();
    expect(link('/test/register')).toBeTruthy();
    expect(link('/test/dashboard')).toBeNull();
  });

  it('offers a signed-in member their dashboard instead of the join button', async () => {
    state.isAuthenticated = true;
    await renderPage();
    expect(link('/test/register')).toBeNull();
    expect(link('/test/dashboard')).toBeTruthy();
  });

  it('shows no join button while the sign-in check is still running', async () => {
    state.isLoading = true;
    await renderPage();
    expect(link('/test/register')).toBeNull();
  });

  // ── The numbers ────────────────────────────────────────────────────────────

  it("shows the community's real numbers", async () => {
    await renderPage();
    const figures = await screen.findByTestId('about-figures');
    expect(within(figures).getByText('31')).toBeInTheDocument();
    expect(within(figures).getByText('members')).toBeInTheDocument();
    expect(within(figures).getByText('443')).toBeInTheDocument();
    expect(within(figures).getByText('hours shared')).toBeInTheDocument();
    expect(within(figures).getByText('20')).toBeInTheDocument();
    expect(within(figures).getByText('offers and requests open now')).toBeInTheDocument();
    // One community is not a number worth showing.
    expect(within(figures).queryByText('communities')).toBeNull();
  });

  // A young community is not shown an empty scoreboard.
  it('leaves out a figure that is zero', async () => {
    state.stats = { members: 4, hours_exchanged: 0, listings: 0, skills: 0, communities: 1 };
    await renderPage();
    const figures = await screen.findByTestId('about-figures');
    expect(within(figures).getByText('members')).toBeInTheDocument();
    expect(within(figures).queryByText('hours shared')).toBeNull();
    expect(within(figures).queryByText('offers and requests open now')).toBeNull();
  });

  it('shows no numbers at all when every figure is zero or they could not be loaded', async () => {
    state.stats = { members: 0, hours_exchanged: 0, listings: 0, skills: 0, communities: 0 };
    const first = await renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'An hour for an hour' })).toBeInTheDocument());
    expect(screen.queryByTestId('about-figures')).toBeNull();
    first.unmount();

    state.statsFail = true;
    await renderPage();
    expect(screen.queryByTestId('about-figures')).toBeNull();
  });

  // ── The story and what matters ─────────────────────────────────────────────

  it('tells one exchange as three steps, in order', async () => {
    await renderPage();
    const steps = Array.from(document.querySelectorAll('ol > li h3')).map((h) => h.textContent);
    expect(steps).toEqual(['Anna gives an hour', 'Anna earns a time credit', 'Anna spends it']);
  });

  it('says what matters to the community', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'What matters to us' })).toBeInTheDocument();
    for (const title of ["Everyone's hour is equal", 'Neighbours first', 'We look out for each other', "Share, don't waste"]) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
    }
  });

  // ── Get in touch ───────────────────────────────────────────────────────────

  it("shows the community's own contact details when it has filled them in", async () => {
    state.contact = { email: 'hello@example.org', phone: '+1 555 123 4567', address: '1 Main Street' };
    await renderPage();
    const details = screen.getByTestId('about-contact-details');
    expect(within(details).getByRole('link', { name: 'hello@example.org' })).toHaveAttribute('href', 'mailto:hello@example.org');
    expect(within(details).getByRole('link', { name: '+1 555 123 4567' })).toHaveAttribute('href', 'tel:+15551234567');
    expect(within(details).getByText('1 Main Street')).toBeInTheDocument();
  });

  it('shows no empty contact list when the community has filled nothing in, and still offers contact and help', async () => {
    await renderPage();
    expect(screen.queryByTestId('about-contact-details')).toBeNull();
    expect(link('/test/contact')).toBeTruthy();
    expect(link('/test/help')).toBeTruthy();
  });

  // ── Credits for the software (attribution) ─────────────────────────────────

  // The credits were made smaller on 14 Nov 2026. They are attribution: every
  // name in contributors.json must still be on the page, visibly.
  it('still credits every contributor by name', async () => {
    await renderPage();
    const software = screen.getByTestId('about-software');
    for (const person of contributors) {
      expect(within(software).getAllByText(new RegExp(person.name)).length, person.name).toBeGreaterThan(0);
    }
    expect(within(software).getByRole('heading', { level: 2, name: 'Powered by Project NEXUS' })).toBeInTheDocument();
  });

  // The Open Source card linked to two repositories until 2026-11-13. The
  // second (the former ASP.NET repository) is no longer public, so only the
  // one platform repository may be offered.
  it('links to the single public repository only', async () => {
    const { container } = await renderPage();
    const sourceLinks = Array.from(container.querySelectorAll('a[href*="github.com"]'));

    expect(sourceLinks).toHaveLength(1);
    expect(sourceLinks[0]?.getAttribute('href')).toBe(PROJECT_NEXUS_REPO_URL);
    expect(container.querySelector('a[href*="api.project-nexus.net"]')).toBeNull();
  });

  // Owner's rule, 13 Nov 2026: the community photo is for the home page only.
  it('does not show the community photo', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('img')).toBeNull();
  });
});
