// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for HeroSection.
 *
 * Design notes
 * ─────────────
 * • HeroSection is a presentational section component.  It reads from
 *   useTenant (branding.name, tenantPath) and useAuth (isAuthenticated).
 * • All text comes either from i18n keys in the 'public' namespace or from
 *   the optional `content` prop override.
 * • We mock @/lib/motion so that motion.div/motion.h1 etc. render as plain
 *   elements (same pattern as HomePage.test.tsx which already works).
 * • We cannot assert on scrollIntoView (jsdom stub) but we can confirm the
 *   scroll-down button is present.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { HeroSection } from './HeroSection';

vi.mock('@/lib/motion', () => {
  const motionProxy = new Proxy({}, {
    get: (_target, prop) => {
      return (
        { children, ref, ...props }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }
      ) => {
        const clean = { ...props };
        delete clean.variants; delete clean.initial; delete clean.animate;
        delete clean.exit; delete clean.transition; delete clean.whileHover;
        delete clean.whileTap; delete clean.whileInView; delete clean.layout;
        delete clean.viewport;
        const Tag = typeof prop === 'string' ? prop : 'div';
        return React.createElement(Tag, { ...clean, ref }, children as React.ReactNode);
      };
    },
  });
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    MotionConfig: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useAnimation: () => ({ start: vi.fn() }),
    useInView: () => true,
  };
});

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useTheme: () => ({ resolvedTheme: 'light', theme: 'system', toggleTheme: vi.fn(), setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  usePresence: () => ({ status: 'offline', setStatus: vi.fn(), getPresence: vi.fn(), isOnline: vi.fn(() => false) }),
  usePresenceOptional: () => null,
}));

describe('HeroSection — unauthenticated user', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a level-1 heading', () => {
    render(<HeroSection />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders with accessible landmark (section with aria-labelledby)', () => {
    render(<HeroSection />);
    const section = screen.getByRole('region');
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('aria-labelledby', 'hero-heading');
  });

  it('renders a primary CTA button (link) for unauthenticated users', () => {
    render(<HeroSection />);
    // Should show "Get started" style link pointing to /register
    const links = screen.getAllByRole('link');
    const primaryCta = links.find((l) => /register/i.test(l.getAttribute('href') ?? ''));
    expect(primaryCta).toBeDefined();
  });

  it('renders a secondary CTA button for unauthenticated users', () => {
    render(<HeroSection />);
    // Should show a link pointing to /about
    const links = screen.getAllByRole('link');
    const secondaryCta = links.find((l) => /about/i.test(l.getAttribute('href') ?? ''));
    expect(secondaryCta).toBeDefined();
  });

  it('renders the scroll-down icon button', () => {
    render(<HeroSection />);
    expect(screen.getByRole('button', { name: /scroll down/i })).toBeInTheDocument();
  });

  it('scroll-down button calls scrollIntoView without crashing', () => {
    const mockScrollIntoView = vi.fn();
    const fakeFeatures = document.createElement('div');
    fakeFeatures.id = 'features';
    fakeFeatures.scrollIntoView = mockScrollIntoView;
    document.body.appendChild(fakeFeatures);

    render(<HeroSection />);
    const scrollBtn = screen.getByRole('button', { name: /scroll down/i });
    fireEvent.click(scrollBtn);
    expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });

    document.body.removeChild(fakeFeatures);
  });

  it('uses content prop overrides when provided', () => {
    render(
      <HeroSection
        content={{
          headline_1: 'Custom Headline One',
          headline_2: 'Custom Headline Two',
          cta_primary_text: 'Custom CTA',
        }}
      />,
    );
    expect(screen.getByText('Custom Headline One')).toBeInTheDocument();
    expect(screen.getByText('Custom Headline Two')).toBeInTheDocument();
    expect(screen.getByText('Custom CTA')).toBeInTheDocument();
  });

  it('uses custom primary CTA link from content prop', () => {
    render(
      <HeroSection
        content={{ cta_primary_link: '/custom-register' }}
      />,
    );
    const links = screen.getAllByRole('link');
    const customLink = links.find((l) =>
      (l.getAttribute('href') ?? '').includes('custom-register'),
    );
    expect(customLink).toBeDefined();
  });
});

describe('HeroSection — authenticated user', () => {
  /** Sign the member in, and switch the named modules off for their community. */
  async function signInWith(disabledModules: string[] = []) {
    const contexts = await import('@/contexts');
    vi.mocked(contexts.useAuth).mockReturnValue({
      user: { id: 1, email: 'u@test.com' } as never,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle',
      error: null,
    });
    vi.mocked(contexts.useTenant).mockReturnValue({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      branding: { name: 'Test Community', logo_url: null },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      // Per key: a mock that ignores the key cannot tell "feed off, dashboard on"
      // from "both off", which is exactly what these cases separate.
      hasModule: vi.fn((key: string) => !disabledModules.includes(key)),
    } as unknown as ReturnType<typeof contexts.useTenant>);
  }

  it('shows a feed CTA instead of register/about for authenticated users', async () => {
    await signInWith();
    render(<HeroSection />);
    // The authenticated CTA links to /feed (via tenantPath)
    const links = screen.getAllByRole('link');
    const feedLink = links.find((l) => /feed/i.test(l.getAttribute('href') ?? ''));
    expect(feedLink).toBeDefined();
    // Should NOT show a /register link
    const registerLink = links.find((l) => /register/.test(l.getAttribute('href') ?? ''));
    expect(registerLink).toBeUndefined();
  });

  /*
    🔴 The signed-in call to action pointed at /feed no matter what the community had
    switched on. It is the biggest button on a community's own front page, so a member
    of a community with the feed off pressed it and the route guard bounced them to the
    dashboard — the button named a place they could not go.
  */
  it('points the signed-in CTA at the dashboard when the community has no feed', async () => {
    await signInWith(['feed']);
    render(<HeroSection />);

    const links = screen.getAllByRole('link');
    expect(links.find((l) => /dashboard/.test(l.getAttribute('href') ?? ''))).toBeDefined();
    expect(links.find((l) => /feed/.test(l.getAttribute('href') ?? ''))).toBeUndefined();
  });

  it('offers no signed-in CTA when neither the feed nor the dashboard is available', async () => {
    await signInWith(['feed', 'dashboard']);
    render(<HeroSection />);

    // queryAllByRole, not getAllByRole: with no CTA the section has no links at
    // all, which is the point — there is no landing page left to offer.
    const links = screen.queryAllByRole('link');
    expect(links.find((l) => /feed|dashboard/.test(l.getAttribute('href') ?? ''))).toBeUndefined();
    // The section still renders — no CTA is not a broken page.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
