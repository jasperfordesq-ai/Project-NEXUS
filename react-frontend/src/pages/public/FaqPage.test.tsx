// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FaqPage
 *
 * Mocking notes
 * ─────────────
 * FaqPage imports `useTenant` from the '@/contexts' barrel, but it also renders
 * `PageMeta` from '@/components/seo/PageMeta' — and that module imports
 * `useTenant` from '@/contexts/TenantContext', the DIRECT path. Vitest resolves
 * mocks per specifier, so a mock of the '@/contexts' barrel never covered
 * PageMeta: the real TenantContext loaded and threw "useTenant must be used
 * within a TenantProvider" before anything rendered. (The '@/components/seo'
 * barrel stub in src/test/setup.ts is bypassed for the same reason.)
 *
 * Mocking '@/contexts/TenantContext' on its DIRECT path covers both callers,
 * because '@/contexts/index.ts' re-exports from './TenantContext'.
 * '@/contexts/AuthContext' is mocked the same way since the real barrel
 * re-exports from it and the real AuthContext imports named session events from
 * '@/lib/api' that this file's api stub does not provide.
 *
 * Both context mocks are total (no importOriginal): the real modules import
 * '@/i18n', which re-runs i18next `.init()` with the HTTP backend at module scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, userEvent } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }) },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const mockHasModule = vi.fn((_module: string) => true);
const mockHasFeature = vi.fn((_feature: string) => true);

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: mockHasFeature,
  hasModule: mockHasModule,
  isLoading: false,
  error: null,
};

const mockAuth = { user: null as { id: number } | null, isAuthenticated: false, isLoading: false };

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => mockTenant,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth,
  useAuthOptional: () => mockAuth,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { FaqPage } from './FaqPage';
import { api } from '@/lib/api';

const GROUPS = ['Getting started', 'Time credits', 'Exchanges and safety', 'Badges and rewards', 'Account and privacy'];

const COMMUNITY_QUESTIONS = [
  { category: 'Joining', faqs: [{ id: 7, question: '¿Cómo me uno al mercado?', answer: '<p>Escribe a la coordinación.</p>' }] },
];

const searchFor = async (words: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole('searchbox', { name: 'Search questions...' }), words);
  return user;
};

describe('FaqPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModule.mockReturnValue(true);
    mockHasFeature.mockReturnValue(true);
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    vi.mocked(api.get).mockResolvedValue({ success: true, data: null } as never);
  });

  it('opens with the warm banner, the search box and every group of questions', () => {
    render(<FaqPage />);
    // Real English copy from public/locales/en/public.json (`faq.*`),
    // preloaded into i18next by src/test/setup.ts.
    expect(screen.getByRole('heading', { level: 1, name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(screen.getByText(/Quick answers about joining Test Community/)).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search questions...' })).toBeInTheDocument();
    for (const group of GROUPS) {
      expect(screen.getByRole('heading', { level: 2, name: group })).toBeInTheDocument();
    }
    // Questions are buttons that open.
    for (const question of ['What is timebanking?', 'Can my balance go negative?', 'How is my data protected?']) {
      expect(screen.getByRole('button', { name: question })).toBeInTheDocument();
    }
    expect(screen.queryByText(/No questions match that/)).not.toBeInTheDocument();
  });

  it('gives the three short answers most visitors come for', () => {
    render(<FaqPage />);
    const glance = within(screen.getByTestId('faq-glance')).getAllByRole('listitem');
    expect(glance).toHaveLength(3);
    expect(glance[0]).toHaveTextContent('Free');
    expect(glance[1]).toHaveTextContent('1 hour = 1 credit');
    expect(glance[2]).toHaveTextContent('Any skill counts');
  });

  it('offers one tile per group that jumps to it', () => {
    render(<FaqPage />);
    const tiles = within(screen.getByTestId('faq-topics')).getAllByRole('link');
    expect(tiles).toHaveLength(5);
    expect(tiles[0]).toHaveTextContent('Getting started');
    expect(tiles[0]).toHaveAttribute('href', '#faq-getting_started');
    // The tile points at a section that is really on the page.
    expect(document.getElementById('faq-getting_started')).not.toBeNull();
    expect(document.getElementById('faq-account_privacy')).not.toBeNull();
  });

  it('closes with ways to get in touch, not a "support team"', () => {
    render(<FaqPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Still have questions?' })).toBeInTheDocument();
    expect(
      screen.getByText('Send us a message and someone from Test Community will get back to you.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/test/contact');
    expect(screen.getByRole('link', { name: 'Help Center' })).toHaveAttribute('href', '/test/help');
    expect(screen.getByRole('link', { name: 'Timebanking Guide' })).toHaveAttribute('href', '/test/timebanking-guide');
    expect(screen.queryByText(/support team is here/i)).not.toBeInTheDocument();
  });

  describe('who is looking', () => {
    it('invites a visitor to join', () => {
      render(<FaqPage />);
      expect(screen.getByRole('link', { name: 'Join us' })).toHaveAttribute('href', '/test/register');
    });

    it('does not ask a member to join', () => {
      mockAuth.user = { id: 5 };
      mockAuth.isAuthenticated = true;
      render(<FaqPage />);
      expect(screen.queryByRole('link', { name: 'Join us' })).not.toBeInTheDocument();
    });

    it('does not ask anyone to join while the sign-in check is still running', () => {
      mockAuth.isLoading = true;
      render(<FaqPage />);
      expect(screen.queryByRole('link', { name: 'Join us' })).not.toBeInTheDocument();
    });

    it('marks a link a visitor must sign in to open', async () => {
      render(<FaqPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Can I donate my credits?' }));
      const wallet = await screen.findByRole('link', { name: /Wallet/ });
      expect(wallet).toHaveAttribute('href', '/test/wallet');
      // The padlock's words become part of the link's name.
      expect(wallet).toHaveAccessibleName(/^Wallet\s*, Sign in to open$/);
    });

    it('shows a member the same link with no padlock', async () => {
      mockAuth.user = { id: 5 };
      mockAuth.isAuthenticated = true;
      render(<FaqPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Can I donate my credits?' }));
      expect(await screen.findByRole('link', { name: 'Wallet' })).toHaveAttribute('href', '/test/wallet');
    });
  });

  describe('what the community has switched off', () => {
    it('does not advertise Settings when the module is disabled', () => {
      mockHasModule.mockImplementation((module: string) => module !== 'settings');

      render(<FaqPage />);

      expect(screen.queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Can I opt out of leaderboards?')).not.toBeInTheDocument();
      expect(screen.queryByText('How do I change my password?')).not.toBeInTheDocument();
      // The rest of the group is still there.
      expect(screen.getByRole('button', { name: 'Who can see my profile?' })).toBeInTheDocument();
    });

    it('does not show a Wallet link or an incomplete Wallet sentence when Wallet is disabled', async () => {
      mockHasModule.mockImplementation((module: string) => module !== 'wallet');

      render(<FaqPage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Can I donate my credits?' }));

      expect(await screen.findByText('Transfer credits to any other member')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Wallet/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/Go to your/)).not.toBeInTheDocument();
    });

    it('leaves out the badges group when the community has no badges', () => {
      mockHasFeature.mockImplementation((feature: string) => feature !== 'gamification');

      render(<FaqPage />);

      expect(screen.queryByRole('heading', { level: 2, name: 'Badges and rewards' })).not.toBeInTheDocument();
      expect(screen.queryByText('What are badges and XP?')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('faq-topics')).getAllByRole('link')).toHaveLength(4);
    });
  });

  describe('searching', () => {
    it('finds a word that is only in an answer, and opens the match', async () => {
      render(<FaqPage />);
      await searchFor('encrypted');

      expect(screen.getByTestId('faq-match-count')).toHaveTextContent('Matching questions: 1');
      expect(screen.getByRole('button', { name: 'How is my data protected?' })).toBeInTheDocument();
      expect(await screen.findByText('Your data is encrypted and securely stored')).toBeInTheDocument();
      // Everything that does not match steps aside.
      expect(screen.queryByRole('heading', { level: 2, name: 'Getting started' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('faq-glance')).not.toBeInTheDocument();
      expect(screen.queryByTestId('faq-topics')).not.toBeInTheDocument();
    });

    it('ignores capitals and accents, and wants every word', async () => {
      render(<FaqPage />);
      await searchFor('WALLET crédits');

      expect(screen.getByTestId('faq-match-count')).toHaveTextContent('Matching questions: 1');
      expect(screen.getByRole('button', { name: 'Can I donate my credits?' })).toBeInTheDocument();
    });

    it('says so kindly when nothing matches, and clears the search', async () => {
      render(<FaqPage />);
      const user = await searchFor('zzzqqq');

      expect(
        screen.getByText('No questions match that. Try a different word, or ask us directly.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('faq-match-count')).toBeEmptyDOMElement();

      await user.click(screen.getByRole('button', { name: 'Clear the search' }));

      expect(screen.queryByText(/No questions match that/)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Getting started' })).toBeInTheDocument();
    });

    it("searches the community's own questions too", async () => {
      vi.mocked(api.get).mockResolvedValue({ success: true, data: COMMUNITY_QUESTIONS } as never);
      render(<FaqPage />);
      await screen.findByText('¿Cómo me uno al mercado?');

      // "coordinación" is in the answer only; typed without its accent.
      await searchFor('coordinacion');

      expect(screen.getByText('¿Cómo me uno al mercado?')).toBeInTheDocument();
      expect(screen.getByTestId('faq-match-count')).toHaveTextContent('Matching questions: 1');
      expect(screen.queryByRole('heading', { level: 2, name: 'Getting started' })).not.toBeInTheDocument();
    });
  });

  // 2026-10-23: the description was identical on every community.
  it("names the community in the page's search-result description", async () => {
    render(<FaqPage />);
    await waitFor(() => {
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(
        /^Common questions about Test Community:/,
      );
    });
  });

  // Until 14 Nov 2026 a search engine was given the first paragraph only.
  it('gives search engines every question with its whole answer', async () => {
    render(<FaqPage />);
    await waitFor(() => {
      expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    });
    const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toHaveLength(20);
    const started = schema.mainEntity.find((entry: { name: string }) => entry.name === 'How do I get started?');
    expect(started.acceptedAnswer.text).toContain("Here's how to begin:");
    expect(started.acceptedAnswer.text).toContain('Have a look around — See what people are offering and asking for');
  });

  // AWID focus group, Oct 2026: "Can we customise the text in places like FAQ?"
  it('shows the community’s own questions above the standard ones', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COMMUNITY_QUESTIONS } as never);

    render(<FaqPage />);

    const own = await screen.findByText('¿Cómo me uno al mercado?');
    expect(screen.getByRole('heading', { name: 'Questions from your community' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/help/faqs');
    const firstStandard = screen.getByRole('button', { name: 'What is timebanking?' });
    expect(own.compareDocumentPosition(firstStandard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
