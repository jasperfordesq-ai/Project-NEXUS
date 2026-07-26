// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RelatedPages component
 *
 * Mocking notes
 * ─────────────
 * This file used to mock the '@/components/ui' barrel and stub `GlassCard` with
 * a <div data-testid="glass-card">. RelatedPages imports GlassCard from
 * '@/components/ui/GlassCard' — the DIRECT path — so Vitest never applied that
 * override: the real GlassCard rendered and the `glass-card` testid could never
 * match. The barrel mock is gone and the assertions target the real component,
 * whose root carries the `glass-card` CLASS (GlassCard.tsx, non-hoverable branch).
 *
 * '@/contexts/TenantContext' is mocked on its DIRECT path (the barrel
 * '@/contexts/index.ts' re-exports from it, so the real barrel still resolves
 * `useTenant`), and '@/contexts/AuthContext' likewise because the barrel
 * re-exports from it and the real AuthContext imports named session events from
 * '@/lib/api' that this file's api stub does not provide. Both mocks are total
 * (no importOriginal): the real modules import '@/i18n', which re-runs i18next
 * `.init()` with the HTTP backend at module scope.
 *
 * react-router-dom is left real — src/test/test-utils.tsx already wraps renders
 * in a BrowserRouter, so <Link> resolves to a real anchor with a real href.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }) },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'hour-timebank' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
};

const mockAuth = { user: null, isAuthenticated: false };

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => stableTenant,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth,
  useAuthOptional: () => mockAuth,
}));

import { RelatedPages } from './RelatedPages';

// Real English copy from public/locales/en/about.json (`related.*`), preloaded
// into i18next by src/test/setup.ts. `hour-timebank` gets the universal
// timebanking-guide entry plus five tenant-specific pages; `current` is excluded.
const EXPECTED_LINKS = [
  { href: '/test/partner', label: 'Partner With Us', description: 'Partnership opportunities' },
  { href: '/test/social-prescribing', label: 'Social Prescribing', description: 'Evidence-based referral pathway' },
  { href: '/test/impact-summary', label: 'Our Impact', description: 'Social return on investment' },
  { href: '/test/impact-report', label: 'Impact Report', description: 'Full 2023 SROI study' },
  { href: '/test/strategic-plan', label: 'Strategic Plan', description: '2026–2030 roadmap' },
] as const;

describe('RelatedPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<RelatedPages current="/timebanking-guide" />);
    const section = container.querySelector('section');
    expect(section).toBeInTheDocument();
    // The section is the strip wrapper — it must actually contain the heading
    // and the link grid, not merely exist.
    expect(section).toContainElement(
      screen.getByRole('heading', { level: 2, name: 'Related Pages' })
    );
    expect(section).toContainElement(screen.getByRole('link', { name: /Partner With Us/ }));
  });

  it('renders related pages heading', () => {
    render(<RelatedPages current="/timebanking-guide" />);
    // Heading renders as "Related Pages" from the about.json locale file
    expect(
      screen.getByRole('heading', { level: 2, name: 'Related Pages' })
    ).toBeInTheDocument();
  });

  it('excludes the current page from links', () => {
    render(<RelatedPages current="/timebanking-guide" />);
    const links = screen.getAllByRole('link');
    // Positive precondition: the five sibling pages DID render, so the absence
    // below cannot pass just because nothing was rendered at all.
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      EXPECTED_LINKS.map((entry) => entry.href)
    );
    // Should NOT show the Timebanking Guide link since it's the current page
    const timebankingLink = links.find(
      (link) => link.getAttribute('href')?.includes('/timebanking-guide')
    );
    expect(timebankingLink).toBeUndefined();
    expect(screen.queryByText('Timebanking Guide')).not.toBeInTheDocument();
  });

  it('renders hour-timebank specific links when tenant is hour-timebank', () => {
    render(<RelatedPages current="/timebanking-guide" />);
    // Every hour-timebank page renders with its real label, description and
    // tenant-scoped href.
    for (const { href, label, description } of EXPECTED_LINKS) {
      const link = screen.getByRole('link', { name: `${label} ${description}` });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('renders links as GlassCards', () => {
    const { container } = render(<RelatedPages current="/timebanking-guide" />);
    // The real GlassCard puts the `glass-card` class on its root element.
    const cards = container.querySelectorAll('.glass-card');
    expect(cards).toHaveLength(EXPECTED_LINKS.length);
    // …one card per link, each nested inside its anchor.
    for (const { href } of EXPECTED_LINKS) {
      const link = container.querySelector(`a[href="${href}"]`);
      expect(link?.querySelector('.glass-card')).toBeInTheDocument();
    }
  });
});
