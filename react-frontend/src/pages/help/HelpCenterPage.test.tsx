// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Help Centre pages: home, topic and article. These render the real guide
 * registry and the real English guide text (src/test/setup.ts loads every
 * English namespace), so a guide that stops rendering fails here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const enabled = { features: new Set<string>(), modules: new Set<string>(), all: true };

const tenant = () => ({
  tenant: { id: 2, name: 'Test Community', slug: 'test' },
  tenantSlug: 'test',
  branding: { name: 'Test Community', logo_url: null },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: (name: string) => enabled.all || enabled.features.has(name),
  hasModule: (name: string) => enabled.all || enabled.modules.has(name),
});

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => tenant()),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [] }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, hasConsent: vi.fn(() => true) }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
}));

// PageMeta imports useTenant by its direct path; see the note in git history
// for why this must be a total factory.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => tenant()),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { HelpCenterPage } from './HelpCenterPage';
import { HelpSectionPage } from './HelpSectionPage';
import { HelpArticlePage } from './HelpArticlePage';
import { api } from '@/lib/api';

const mockApiGet = vi.mocked(api.get);

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <Routes>
      <Route path="/help" element={<HelpCenterPage />} />
      <Route path="/help/:audience" element={<HelpCenterPage />} />
      <Route path="/help/:audience/:sectionId" element={<HelpSectionPage />} />
      <Route path="/help/:audience/:sectionId/:articleId" element={<HelpArticlePage />} />
    </Routes>,
  );
}

describe('Help Centre home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.all = true;
    enabled.features.clear();
    enabled.modules.clear();
    mockApiGet.mockResolvedValue({ success: true, data: [] });
  });

  it('offers the three guides', () => {
    renderAt('/help');
    const nav = screen.getByRole('navigation', { name: 'Choose a guide' });
    expect(within(nav).getByRole('link', { name: /Using the platform/ })).toHaveAttribute('href', '/test/help');
    expect(within(nav).getByRole('link', { name: /For brokers and coordinators/ })).toHaveAttribute('href', '/test/help/brokers');
    expect(within(nav).getByRole('link', { name: /For community admins/ })).toHaveAttribute('href', '/test/help/admins');
  });

  it('lists member topics that link to their pages', () => {
    renderAt('/help');
    expect(screen.getByRole('link', { name: /Getting started/ })).toHaveAttribute('href', '/test/help/members/getting_started');
    expect(screen.getByRole('link', { name: /Group exchanges/ })).toHaveAttribute('href', '/test/help/members/group_exchanges');
  });

  it('shows the broker guide on /help/brokers', () => {
    renderAt('/help/brokers');
    expect(screen.getByRole('link', { name: /Workshops and group activities/ }))
      .toHaveAttribute('href', '/test/help/brokers/broker_group_activities');
  });

  it('hides topics for features the community has switched off', () => {
    enabled.all = false;
    enabled.modules.add('wallet');
    renderAt('/help');
    expect(screen.queryByRole('link', { name: /Group exchanges/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Getting started/ })).toBeInTheDocument();
  });

  it('searches every guide by whole word', async () => {
    renderAt('/help');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the Help Centre' }), { target: { value: 'community pot' } });
    expect(await screen.findByRole('heading', { name: 'Guides matching "community pot"' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Recording hours for a workshop or group activity/ }))
      .toHaveAttribute('href', '/test/help/members/group_exchanges/workshop_community_pot');
    expect(screen.getByRole('link', { name: /Using a Community Pot account for workshops/ })).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    renderAt('/help?q=xyzzyplugh');
    expect(await screen.findByText('No guides matched your search')).toBeInTheDocument();
  });

  it("shows the community's own questions", async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: [{ category: 'Local', faqs: [{ id: 7, question: 'Where do we meet?', answer: 'At the library.' }] }],
    });
    renderAt('/help');
    expect(await screen.findByText('Questions from your community')).toBeInTheDocument();
    expect(screen.getByText('Where do we meet?')).toBeInTheDocument();
  });

  it('always offers a way to contact a person', () => {
    renderAt('/help');
    expect(screen.getByText('Still need help?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/test/contact');
  });
});

describe('Help Centre topic and article pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.all = true;
    mockApiGet.mockResolvedValue({ success: true, data: [] });
  });

  it('lists the guides in a topic', () => {
    renderAt('/help/members/group_exchanges');
    expect(screen.getByRole('heading', { level: 1, name: 'Group exchanges' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Recording hours for a workshop or group activity/ })).toBeInTheDocument();
  });

  it('renders an article with its steps and a link to the page it is about', () => {
    renderAt('/help/members/group_exchanges/workshop_community_pot');
    expect(screen.getByRole('heading', { level: 1, name: 'Recording hours for a workshop or group activity' })).toBeInTheDocument();
    expect(screen.getAllByRole('list').length).toBeGreaterThan(0);
    expect(screen.getByText('More guides in this topic')).toBeInTheDocument();
  });

  it('shows a friendly page for a guide that does not exist', () => {
    renderAt('/help/members/group_exchanges/no_such_guide');
    expect(screen.getByRole('heading', { name: "We couldn't find that guide" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the Help Centre' })).toHaveAttribute('href', '/test/help');
  });

  it('treats a switched-off feature as not found', () => {
    enabled.all = false;
    renderAt('/help/members/group_exchanges/workshop_community_pot');
    expect(screen.getByRole('heading', { name: "We couldn't find that guide" })).toBeInTheDocument();
  });

  it('keeps the email reply to Timebanking UK true: members need not share phone numbers', async () => {
    renderAt('/help?q=phone');
    await waitFor(() => expect(screen.getByRole('link', { name: /Do other members see my phone number or email/ })).toBeInTheDocument());
  });
});
