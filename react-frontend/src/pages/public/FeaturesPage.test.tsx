// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── SEO / page hooks ──────────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Contexts ──────────────────────────────────────────────────────────────────
// What the community has switched on, and who is looking, change per test.
const state = vi.hoisted(() => ({
  /** Everything on (true) or everything off (false)… */
  switchedOn: true,
  /** …except these keys, which are off… */
  off: new Set<string>(),
  /** …or, when set, exactly this one key on and every other key off. */
  only: null as string | null,
  languages: ['en', 'ga'] as string[],
  isAuthenticated: false,
  isLoading: false,
}));

function isOn(key: string): boolean {
  if (state.only !== null) return key === state.only;
  return state.switchedOn && !state.off.has(key);
}

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      branding: { name: 'Test Timebank' },
      tenantPath: (p: string) => `/test${p}`,
      supportedLanguages: state.languages,
      hasFeature: (key: string) => isOn(key),
      hasModule: (key: string) => isOn(key),
    }),
    useAuth: () => ({
      user: state.isAuthenticated ? { id: 7, first_name: 'Maeve' } : null,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
    }),
  })
);

const CARD_PATHS = [
  '/test/listings',
  '/test/wallet',
  '/test/members',
  '/test/events',
  '/test/groups',
  '/test/volunteering',
  '/test/messages',
  '/test/feed',
];

async function renderPage() {
  const { FeaturesPage } = await import('./FeaturesPage');
  return render(<FeaturesPage />);
}

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

// ─────────────────────────────────────────────────────────────────────────────
describe('FeaturesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.switchedOn = true;
    state.off = new Set();
    state.only = null;
    state.languages = ['en', 'ga'];
    state.isAuthenticated = false;
    state.isLoading = false;
  });

  // ── The opening ────────────────────────────────────────────────────────────

  it('opens with one heading that names the community, not the platform', async () => {
    await renderPage();
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe('What you can do in Test Timebank');
  });

  it('invites a signed-out visitor to join', async () => {
    await renderPage();
    expect(link('/test/register')).toBeTruthy();
  });

  it('does not ask a signed-in member to join', async () => {
    state.isAuthenticated = true;
    await renderPage();
    expect(link('/test/register')).toBeNull();
  });

  it('shows neither the join button nor padlocks while the sign-in check is still running', async () => {
    state.isLoading = true;
    await renderPage();
    expect(link('/test/register')).toBeNull();
    expect(document.querySelector('[data-sign-in-lock]')).toBeNull();
  });

  // ── The friendly cards ─────────────────────────────────────────────────────

  it('shows a card for each thing the community has switched on, linking to the real page', async () => {
    await renderPage();
    for (const path of CARD_PATHS) {
      expect(link(path), path).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Things you can do here' })).toBeInTheDocument();
  });

  // The page must never promise something this community lacks.
  it('shows no cards, and no empty cards section, when nothing is switched on', async () => {
    state.switchedOn = false;
    await renderPage();
    for (const path of CARD_PATHS) {
      expect(link(path), path).toBeNull();
    }
    expect(screen.queryByRole('heading', { level: 2, name: 'Things you can do here' })).toBeNull();
    // The rest of the page still stands.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(link('/test/install-app')).toBeTruthy();
  });

  // One switch answering every question would let a card read the wrong key
  // and still pass. With exactly one thing on, exactly its card may show.
  it('shows only the card whose own part of the site is switched on', async () => {
    state.only = 'events';
    await renderPage();
    for (const path of CARD_PATHS) {
      if (path === '/test/events') expect(link(path), path).toBeTruthy();
      else expect(link(path), path).toBeNull();
    }
  });

  // The messages page needs BOTH the messages module and direct messaging;
  // with the second off it opens on a "messaging is switched off" notice.
  it('does not offer messages when direct messaging is switched off', async () => {
    state.off = new Set(['direct_messaging']);
    await renderPage();
    expect(link('/test/messages')).toBeNull();
    expect(link('/test/feed')).toBeTruthy();
  });

  it('mentions a choice of language only when the community offers more than one', async () => {
    await renderPage();
    expect(screen.getByText('In your language')).toBeInTheDocument();
  });

  it('says nothing about languages in a one-language community', async () => {
    state.languages = ['en'];
    await renderPage();
    expect(screen.queryByText('In your language')).toBeNull();
    expect(link('/test/install-app')).toBeTruthy();
  });

  it('puts the padlock on every card a signed-out visitor cannot open yet', async () => {
    await renderPage();
    for (const path of CARD_PATHS) {
      expect(link(path)?.querySelector('[data-sign-in-lock]'), path).toBeTruthy();
    }
    // Open pages carry none.
    expect(link('/test/install-app')?.querySelector('[data-sign-in-lock]')).toBeNull();
    expect(link('/test/trust-and-safety')?.querySelector('[data-sign-in-lock]')).toBeNull();
  });

  it('shows a signed-in member no padlocks', async () => {
    state.isAuthenticated = true;
    await renderPage();
    expect(document.querySelector('[data-sign-in-lock]')).toBeNull();
  });

  // Owner, 26 Oct 2026: Caring Community is unfinished and is never promoted.
  it('never links to Caring Community', async () => {
    await renderPage();
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.includes('caring'))).toEqual([]);
  });

  // ── The full list ──────────────────────────────────────────────────────────

  it('keeps the full list closed until someone opens a group', async () => {
    await renderPage();
    const triggers = document.querySelectorAll('[data-feature-group] button[aria-expanded]');
    expect(triggers).toHaveLength(8);
    for (const trigger of triggers) {
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
  });

  // /features is prerendered for search engines, which are served a snapshot
  // of the DOM. A closed group must therefore still CONTAIN its entries. If
  // someone swaps the Disclosure for a component that unmounts what it hides
  // (tabs, a conditional render), this test is what should stop them.
  it('keeps every entry in the page while its group is closed', async () => {
    await renderPage();
    const items = document.querySelectorAll('ul[data-feature-list] > li');
    // 100+ entries across the eight groups; guard the order of magnitude so
    // adding a feature does not fail the suite.
    expect(items.length).toBeGreaterThan(100);
    // The first entry and one from the last group, both inside closed groups.
    expect(document.body.textContent).toContain('Timebanking Engine');
    expect(document.body.textContent).toContain('GDPR Compliance Suite');
  });

  it('opens a group when its heading is pressed', async () => {
    await renderPage();
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-feature-group="core_platform"] button[aria-expanded]'
    );
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');
  });

  it('says in one line that a community chooses what to switch on', async () => {
    await renderPage();
    const note = document.querySelector('[data-availability-note]');
    expect(note?.textContent).toContain('Each community chooses which parts to switch on');
    expect(note?.textContent).toContain('Test Timebank');
    // …and what to do about it.
    expect(note?.textContent).toContain('ask whoever runs your community');
    // Above the list it is about, never below it.
    const list = document.querySelector('[data-feature-group]');
    expect(note!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the groups that match a search and hides the rest', async () => {
    await renderPage();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'passkeys' } });

    const groups = document.querySelectorAll('[data-feature-group]');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(8);
    for (const group of groups) {
      expect(group.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('lets a group be closed during a search, and forgets that when the search changes', async () => {
    await renderPage();
    const trigger = (key: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-feature-group="${key}"] button[aria-expanded]`
      );
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');

    // Opened by hand before searching…
    fireEvent.click(trigger('core_platform')!);
    expect(trigger('core_platform')!.getAttribute('aria-expanded')).toBe('true');

    fireEvent.change(input!, { target: { value: 'credits' } });
    const found = trigger('member_experience');
    expect(found?.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(found!);
    expect(trigger('member_experience')!.getAttribute('aria-expanded')).toBe('false');

    // …a new search opens its matches again…
    fireEvent.change(input!, { target: { value: 'credit' } });
    expect(trigger('member_experience')!.getAttribute('aria-expanded')).toBe('true');

    // …and clearing it gives back what was open before, and only that.
    fireEvent.change(input!, { target: { value: '' } });
    expect(trigger('core_platform')!.getAttribute('aria-expanded')).toBe('true');
    expect(trigger('member_experience')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('says so, and offers a way back, when a search matches nothing', async () => {
    await renderPage();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    fireEvent.change(input!, { target: { value: 'zzzz-no-such-thing' } });

    expect(document.querySelectorAll('[data-feature-group]')).toHaveLength(0);
    expect(screen.getByText('Nothing matches that search')).toBeInTheDocument();

    // The search box has its own clear button; this is the one in the message.
    const wayBack = document.querySelector<HTMLButtonElement>('[data-no-results] button');
    expect(wayBack?.textContent).toBe('Clear search');
    fireEvent.click(wayBack!);
    expect(document.querySelectorAll('[data-feature-group]')).toHaveLength(8);
    expect(document.querySelectorAll('ul[data-feature-list] > li').length).toBeGreaterThan(100);
  });

  it('labels beta, preview and built-not-enabled entries', async () => {
    await renderPage();
    const labels = new Set(
      Array.from(document.querySelectorAll('ul[data-feature-list] [class*="chip"]')).map(
        (chip) => chip.textContent?.trim()
      )
    );
    expect(labels).toEqual(new Set(['Beta', 'Preview', 'Built, not enabled']));
  });

  // ── For the technically minded ─────────────────────────────────────────────

  it('keeps the technical notes in one closed section', async () => {
    await renderPage();
    const trigger = document.querySelector('[data-technical-notes] button[aria-expanded]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.textContent).toContain('For the technically minded');
  });

  it('still carries the label key, the tech stack, the open-source links and the security address', async () => {
    await renderPage();
    const notes = document.querySelector('[data-technical-notes]');
    expect(notes).toBeTruthy();
    expect(screen.getByText('GA')).toBeInTheDocument();
    expect(notes!.querySelectorAll('li strong').length).toBeGreaterThan(0);
    expect(link('https://github.com/jasperfordesq-ai/Project-NEXUS')).toBeTruthy();
    expect(link('https://project-nexus.canny.io/')).toBeTruthy();
    expect(link('mailto:jasper@hour-timebank.ie')).toBeTruthy();
    expect(link('/test/changelog')).toBeTruthy();
    expect(link('/test/about')).toBeTruthy();
  });
});
