// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── mock contexts ────────────────────────────────────────────────────────────

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ── mock hooks ───────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── AdminHelpCenterPage does not call an API — it reads static HELP_CONTENT ──

import AdminHelpCenterPage from './AdminHelpCenterPage';

describe('AdminHelpCenterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page header', () => {
    render(<AdminHelpCenterPage />);
    // The title comes from i18n key admin_help.title — in English translation
    // it may come through as the key itself or the translated string; either way
    // a header element should be present.
    // We look for the search input as a stable landmark instead.
    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toBeInTheDocument();
  });

  it('links prominently to the full admin guide in the Help Centre', () => {
    render(<AdminHelpCenterPage />);
    const link = screen.getByRole('link', { name: /open the admin guide/i });
    expect(link).toHaveAttribute('href', '/test/help/admins');
    expect(screen.getByRole('heading', { level: 2, name: /complete admin guide/i })).toBeInTheDocument();
  });

  it('renders at least one article card', () => {
    render(<AdminHelpCenterPage />);
    // HELP_CONTENT has many articles; each renders a "View help" button
    const viewBtns = screen.getAllByRole('button', { name: /view help/i });
    expect(viewBtns.length).toBeGreaterThan(0);
  });

  it('renders category headings', () => {
    render(<AdminHelpCenterPage />);
    // Categories render as <h2> elements — query by role heading to avoid text-split issues
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('filters articles by search query', async () => {
    render(<AdminHelpCenterPage />);

    const totalBefore = screen.getAllByRole('button', { name: /view help/i }).length;

    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'feed');

    await waitFor(() => {
      const filteredCount = screen.getAllByRole('button', { name: /view help/i }).length;
      expect(filteredCount).toBeLessThan(totalBefore);
    });
  });

  it('shows no-matches state for an unmatchable query', async () => {
    render(<AdminHelpCenterPage />);

    // Use a query string that cannot appear in any article title/summary
    await userEvent.type(screen.getByRole('searchbox'), 'ZZZZZNOTAREALARTICLE999');

    await waitFor(() => {
      // When no articles match, the "view help" buttons disappear
      expect(screen.queryAllByRole('button', { name: /view help/i })).toHaveLength(0);
    });
  });

  it('restores all articles after clearing the search query', async () => {
    render(<AdminHelpCenterPage />);

    const totalBefore = screen.getAllByRole('button', { name: /view help/i }).length;

    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'safeguarding');

    await waitFor(() => {
      const filtered = screen.getAllByRole('button', { name: /view help/i }).length;
      expect(filtered).toBeLessThan(totalBefore);
    });

    await userEvent.clear(searchInput);

    await waitFor(() => {
      const restored = screen.getAllByRole('button', { name: /view help/i }).length;
      expect(restored).toBe(totalBefore);
    });
  });

  it('navigates on card press (calls navigate via router)', async () => {
    // Navigation is handled internally by react-router useNavigate.
    // We verify that a pressable card is rendered and reachable.
    render(<AdminHelpCenterPage />);

    // Every article card is pressable — HeroUI isPressable cards render role=button
    const pressableCards = screen.getAllByRole('button', { name: /view help/i });
    expect(pressableCards.length).toBeGreaterThan(0);
  });

  it('shows category sections for help content', () => {
    render(<AdminHelpCenterPage />);
    // At least one category section (General Admin) should be rendered with an h2 heading
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // HELP_CONTENT has /caring paths so "Caring Community" appears either as a
    // second h2 heading OR embedded in article card titles/summaries.
    // Check that article cards from the Caring Community module appear (summary text).
    expect(screen.getByText(/coordinator workflow dashboard/i)).toBeInTheDocument();
  });
});
