// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NotFoundPage
 *
 * NotFoundPage imports `useTenant` from its DIRECT path
 * ('@/contexts/TenantContext'), so the stub has to live on that path — Vitest
 * resolves mocks per specifier, so a '@/contexts' barrel mock is never
 * consulted for a direct-path import and the real provider-backed hook throws.
 *
 * The mock is deliberately total (no importOriginal): loading the real
 * TenantContext module pulls in '@/i18n', which unconditionally re-initialises
 * i18next with the HTTP/localStorage backends and would wipe the English locale
 * resources that src/test/setup.ts preloads — so assertions could no longer be
 * made against real English copy. Nothing in this render graph needs any other
 * TenantContext export.
 *
 * Everything else (Button, GlassCard, PageMeta, usePageTitle) renders for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 404 text', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders a page heading', () => {
    render(<NotFoundPage />);
    // utility.not_found.heading — real English copy from public/locales/en
    expect(
      screen.getByRole('heading', { level: 1, name: 'Page Not Found' })
    ).toBeInTheDocument();
  });

  it('renders a link to go home', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/test/');
  });

  it('renders a link to the search page', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('link', { name: /search/i })).toHaveAttribute('href', '/test/search');
  });

  it('renders a go back button', () => {
    render(<NotFoundPage />);
    // utility.not_found.go_back — the only <button> on the page (the other two
    // actions are router links), asserted by accessible name rather than index.
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });

  it('calls window.history.back when the go-back button is clicked', () => {
    const historyBackSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<NotFoundPage />);
    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    expect(historyBackSpy).toHaveBeenCalled();
    historyBackSpy.mockRestore();
  });
});
