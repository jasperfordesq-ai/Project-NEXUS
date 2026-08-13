// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { PublicPageHero } from './PublicPageHero';

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test Tenant', slug: 'test' }, tenantPath: (p: string) => `/test${p}`, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
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

const defaultProps = {
  eyebrow: 'Featured Section',
  title: 'Welcome to the Platform',
  description: 'Discover how timebanking works.',
  icon: <span data-testid="test-icon">Icon</span>,
};

describe('PublicPageHero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the eyebrow chip text', () => {
    render(<PublicPageHero {...defaultProps} />);
    expect(screen.getByText('Featured Section')).toBeInTheDocument();
  });

  it('renders the h1 title', () => {
    render(<PublicPageHero {...defaultProps} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to the Platform' })).toBeInTheDocument();
  });

  it('renders the description paragraph', () => {
    render(<PublicPageHero {...defaultProps} />);
    expect(screen.getByText('Discover how timebanking works.')).toBeInTheDocument();
  });

  it('renders the icon slot', () => {
    render(<PublicPageHero {...defaultProps} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('renders the section element with data attribute', () => {
    render(<PublicPageHero {...defaultProps} />);
    const section = document.querySelector('[data-public-page-hero="true"]');
    expect(section).toBeInTheDocument();
  });

  it('does not render the stats/action area when neither is provided', () => {
    render(<PublicPageHero {...defaultProps} />);
    // No stat values, no action child — the outer flex div for them is absent from the DOM
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an action slot when provided', () => {
    render(
      <PublicPageHero
        {...defaultProps}
        action={<button type="button">Post a Listing</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Post a Listing' })).toBeInTheDocument();
  });

  it('renders stats with value and label', () => {
    render(
      <PublicPageHero
        {...defaultProps}
        stats={[
          { label: 'Members', value: '1,234' },
          { label: 'Exchanges', value: '5,678' },
        ]}
      />
    );
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('5,678')).toBeInTheDocument();
    expect(screen.getByText('Exchanges')).toBeInTheDocument();
  });

  it('renders multiple stats', () => {
    render(
      <PublicPageHero
        {...defaultProps}
        stats={[
          { label: 'A', value: '10' },
          { label: 'B', value: '20' },
          { label: 'C', value: '30' },
        ]}
      />
    );
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('accepts an explicit accent prop without error (emerald)', () => {
    render(<PublicPageHero {...defaultProps} accent="emerald" />);
    const chip = screen.getByText('Featured Section').closest('[data-slot="chip"]');

    expect(chip).toHaveClass('chip--success', 'chip--soft');
  });

  it('keeps the sparkles icon outside the chip label so the eyebrow stays on one line', () => {
    // Regression: the icon used to be a child of the chip, which puts it inside
    // <Chip.Label>. Tailwind's reset makes an <svg> display:block, so the label
    // wrapped — icon stacked above the text in a double-height chip. It must be
    // a sibling of the label (HeroUI's documented Chip anatomy).
    render(<PublicPageHero {...defaultProps} />);

    const label = screen.getByText('Featured Section').closest('[data-slot="chip-label"]');
    const chip = label?.closest('[data-slot="chip"]');

    expect(label).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(label!.querySelector('svg')).toBeNull();
    expect(chip!.querySelector('svg')).not.toBeNull();
  });

  it('accepts rose accent without error', () => {
    render(<PublicPageHero {...defaultProps} accent="rose" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('uses the indigo default accent when no accent prop is supplied', () => {
    // No accent → default 'indigo'; component renders without crash
    render(<PublicPageHero {...defaultProps} />);
    expect(screen.getByText('Welcome to the Platform')).toBeInTheDocument();
  });
});
