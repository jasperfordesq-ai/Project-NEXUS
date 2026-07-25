// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub HeroUI Accordion to render children in jsdom ────────────────────────
// HeroUI Accordion is built on React Aria and uses animations that don't render
// collapsed panels in jsdom. Stub it to always expand content.
//
// 🔴 Do NOT reach for `importOriginal()` here. `src/components/ui/index.ts`
// re-exports four modules that themselves `import … from '@/components/ui'`
// (BackToTop, AlgorithmLabel, GlassInput, Skeletons), so loading the real
// barrel from inside this factory re-enters the very specifier being mocked
// while this factory is still pending — a self-referential await that vite-node
// can fail to settle, which is the classic "fork worker pegs a core at 100% and
// the run never terminates" hang. `PartnerTimebankGuidance` imports exactly the
// three names stubbed below, so an explicit, self-contained factory is both
// sufficient and cycle-free.
vi.mock('@/components/ui', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="accordion">{children}</div>
  ),
  AccordionItem: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: React.ReactNode;
  }) => (
    <div data-testid="accordion-item">
      {/* Real AccordionItem renders its title as the disclosure trigger button;
          keep that role so trigger-level assertions stay meaningful. */}
      <button type="button" data-testid="accordion-title">
        {title}
      </button>
      <div data-testid="accordion-content">{children}</div>
    </div>
  ),
  Chip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="chip">{children}</span>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('PartnerTimebankGuidance', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders without crashing for settings page', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    expect(screen.getByTestId('accordion')).toBeInTheDocument();
  });

  it('renders section element with aria-label', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    // The section has an aria-label from the translated title key
    const section = document.querySelector('section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('aria-label');
  });

  it('renders the Partner Timebank Area chip', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    expect(screen.getByTestId('chip')).toBeInTheDocument();
  });

  it('renders three accordion panels (fit, steps, related)', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    const items = screen.getAllByTestId('accordion-item');
    expect(items).toHaveLength(3);
  });

  it('renders ordered steps list inside steps panel', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="partnerships" />);
    const listItems = document.querySelectorAll('ol li');
    expect(listItems.length).toBe(3);
  });

  it('renders related links for the settings page', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    // settings page has 3 related links: partnerships, externalPartners, apiPartners
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  it('related links include tenantPath prefix', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="settings" />);
    const links = screen.getAllByRole('link') as HTMLAnchorElement[];
    // All links should start with /test (the mock tenantPath prefix)
    links.forEach((link) => {
      expect(link.getAttribute('href')).toMatch(/^\/test\//);
    });
  });

  it('renders related links for creditAgreements page', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="creditAgreements" />);
    const links = screen.getAllByRole('link');
    // creditAgreements has 3 related links
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  it('renders for every valid page without crashing', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    const pages = [
      'settings',
      'partnerships',
      'directory',
      'creditAgreements',
      'externalPartners',
      'apiKeys',
      'apiDocs',
      'webhooks',
      'creditCommons',
      'apiPartners',
      'dataManagement',
      'activityFeed',
      'analytics',
      'aggregates',
    ] as const;

    for (const page of pages) {
      const { unmount } = render(<PartnerTimebankGuidance page={page} />);
      expect(screen.getByTestId('accordion')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the fit accordion panel content', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="webhooks" />);
    const contents = screen.getAllByTestId('accordion-content');
    // First panel (fit) should contain paragraphs
    expect(contents[0]).toBeInTheDocument();
  });

  it('analytics page links point to activity and aggregates', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="analytics" />);
    const links = screen.getAllByRole('link') as HTMLAnchorElement[];
    const hrefs = links.map((l) => l.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('activity') || h.includes('aggregates'))).toBe(true);
  });

  it('activityFeed page has exactly 2 related links', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="activityFeed" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
  });

  // Merged from the former __tests__/PartnerTimebankGuidance.test.tsx duplicate:
  // asserts the resolved translation copy and the exact related-link targets.
  it('explains where the protocol API guide fits and links to related setup pages', async () => {
    const { PartnerTimebankGuidance } = await import('./PartnerTimebankGuidance');
    render(<PartnerTimebankGuidance page="apiDocs" />);

    expect(screen.getByText('Use this guide to explain the protocol stack')).toBeInTheDocument();
    expect(screen.getByText('Where this page fits')).toBeInTheDocument();
    expect(screen.getByText('Recommended order')).toBeInTheDocument();
    expect(screen.getByText('Partner timebank admin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Related pages' }));

    // Related links point into the Partner Timebanks panel (2026-07-02) —
    // the old /admin/federation/* routes were retired without redirects.
    expect(screen.getByRole('link', { name: 'External Protocol Partners' })).toHaveAttribute(
      'href',
      '/test/partner-timebanks/external-partners',
    );
    expect(screen.getByRole('link', { name: 'Inbound API Partners' })).toHaveAttribute(
      'href',
      '/test/partner-timebanks/inbound-api',
    );
  });
});
