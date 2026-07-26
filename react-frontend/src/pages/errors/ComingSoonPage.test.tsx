// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ComingSoonPage
 *
 * ComingSoonPage imports `useTenant` from its DIRECT path
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

import { ComingSoonPage } from './ComingSoonPage';

describe('ComingSoonPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading', () => {
    render(<ComingSoonPage />);
    // utility.coming_soon.heading — real English copy from public/locales/en
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coming Soon' })
    ).toBeInTheDocument();
  });

  it('renders a link to the dashboard', () => {
    render(<ComingSoonPage />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'href',
      '/test/dashboard'
    );
  });

  it('renders a go back button', () => {
    render(<ComingSoonPage />);
    // utility.coming_soon.go_back — the only <button> on the page (the dashboard
    // action is a router link), asserted by accessible name rather than index.
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });

  it('calls window.history.back when go-back button is clicked', () => {
    const historyBackSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<ComingSoonPage />);
    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    expect(historyBackSpy).toHaveBeenCalled();
    historyBackSpy.mockRestore();
  });

  it('renders with a custom feature prop', () => {
    render(<ComingSoonPage feature="Advanced Analytics" />);
    // utility.coming_soon.description interpolates {{feature}} — assert the prop
    // actually reaches the rendered copy, not merely that the page mounted.
    expect(
      screen.getByText('Advanced Analytics is currently under development. Check back soon!')
    ).toBeInTheDocument();
  });

  it('renders with the default "This feature" text when no feature prop given', () => {
    render(<ComingSoonPage />);
    expect(
      screen.getByText('This feature is currently under development. Check back soon!')
    ).toBeInTheDocument();
  });
});
