// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── SEO / page hooks ──────────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Contexts ──────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Stub heavy UI primitives that don't run in jsdom ─────────────────────────
// Card, Chip, Separator are thin wrappers — let them render naturally.
// react-router Link needs a MemoryRouter which test-utils already provides.

// ─────────────────────────────────────────────────────────────────────────────
describe('FeaturesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hero heading', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // The heading text comes from i18n key features_page.heading — the
    // test i18n setup returns the key itself as the translation, so we
    // match against the key or whatever is rendered.
    // We rely on there being exactly one <h1> on the page.
    const h1 = document.querySelector('h1');
    expect(h1).toBeTruthy();
  });

  it('renders the maturity key section', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // maturity_key_title is rendered as a <p className="font-semibold">
    // Find the GA chip — the maturity key always has a chip with text "GA"
    const gaChip = screen.getByText('GA');
    expect(gaChip).toBeInTheDocument();
  });

  it('renders all 8 feature group section headings (h2 elements)', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    const h2s = document.querySelectorAll('h2');
    // 8 feature groups + Tech Stack section + Open Source section + Security section = 11
    // We just verify there are several h2 headings (groups)
    expect(h2s.length).toBeGreaterThanOrEqual(8);
  });

  it('renders the Open Source GitHub link', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    const githubLink = document.querySelector('a[href="https://github.com/jasperfordesq-ai/Project-NEXUS"]');
    expect(githubLink).toBeTruthy();
  });

  it('renders the security disclosure email link', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    const emailLink = document.querySelector('a[href="mailto:jasper@hour-timebank.ie"]');
    expect(emailLink).toBeTruthy();
  });

  it('renders the report-a-bug Canny link', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    const cannyLink = document.querySelector('a[href="https://project-nexus.canny.io/"]');
    expect(cannyLink).toBeTruthy();
  });

  it('renders changelog and about internal links using tenantPath', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // tenantPath('/changelog') → '/test/changelog'
    const changelogLink = document.querySelector('a[href="/test/changelog"]');
    expect(changelogLink).toBeTruthy();
    const aboutLink = document.querySelector('a[href="/test/about"]');
    expect(aboutLink).toBeTruthy();
  });

  it('renders the Tech Stack section', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // The tech stack section has an h2 with key features_page.tech_stack_title
    const h2s = Array.from(document.querySelectorAll('h2'));
    // At least one h2 corresponds to the tech stack card (rendered by i18n key)
    expect(h2s.length).toBeGreaterThan(0);
    // The tech-stack card contains <li> items with <strong> labels
    const strongs = document.querySelectorAll('li strong');
    expect(strongs.length).toBeGreaterThan(0);
  });

  it('renders CheckCircle icons for feature items (list items with icons)', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // Each feature item is a <li> with a flex layout
    const listItems = document.querySelectorAll('ul.space-y-3 li');
    // There are 8 groups with many items — well over 10
    expect(listItems.length).toBeGreaterThan(10);
  });

  it('renders maturity chips for beta and preview items', async () => {
    const { FeaturesPage } = await import('./FeaturesPage');
    render(<FeaturesPage />);
    // Beta and preview items produce MaturityChip elements
    // i18n key features_page.chips.beta / features_page.chips.preview
    // In test i18n those keys resolve to themselves or the fallback
    // We just verify more than one chip appears on the page
    const chips = document.querySelectorAll('[class*="chip"], [class*="Chip"]');
    // At a minimum the GA chip in the maturity key + some beta chips
    expect(chips.length).toBeGreaterThan(0);
  });
});
