// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { PublicPageHero, PublicPageHeroStrip } from './PublicPageHero';

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test Tenant', slug: 'test' }, tenantPath: (p: string) => `/test${p}`, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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

  it('follows the community colour on every page once a community has chosen one', async () => {
    function CommunityColour() {
      const { setCommunityAccent } = useTheme();
      useEffect(() => setCommunityAccent('#a3195b'), [setCommunityAccent]);
      return null;
    }

    render(
      <ThemeProvider>
        <CommunityColour />
        <PublicPageHero {...defaultProps} accent="emerald" />
      </ThemeProvider>
    );

    await waitFor(() => {
      const chip = screen.getByText('Featured Section').closest('[data-slot="chip"]');
      expect(chip).toHaveClass('chip--accent');
    });
  });

  it("is a soft panel in the page's own colour, in light and dark mode", () => {
    render(<PublicPageHero {...defaultProps} accent="amber" />);
    const section = document.querySelector('[data-public-page-hero="true"]');
    expect(section?.className).toContain('rounded-3xl');
    expect(section?.className).toContain('bg-amber-500/10');
    expect(section?.className).toContain('dark:bg-amber-500/15');
    // Darker body text than before, so it stays readable on the tint.
    expect(screen.getByText('Discover how timebanking works.').className).toContain('text-theme-secondary');
  });

  it("takes the community colour's soft tint once the community has chosen one", async () => {
    function CommunityColour() {
      const { setCommunityAccent } = useTheme();
      useEffect(() => setCommunityAccent('#a3195b'), [setCommunityAccent]);
      return null;
    }
    render(
      <ThemeProvider>
        <CommunityColour />
        <PublicPageHero {...defaultProps} accent="amber" />
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(document.querySelector('[data-public-page-hero="true"]')?.className).toContain('bg-accent-soft');
    });
  });

  it('keeps its own page colour when the community has not chosen one', () => {
    render(
      <ThemeProvider>
        <PublicPageHero {...defaultProps} accent="emerald" />
      </ThemeProvider>
    );

    const chip = screen.getByText('Featured Section').closest('[data-slot="chip"]');
    expect(chip).toHaveClass('chip--success');
  });

  describe('compact — the opening of everyday pages (messages, wallet, notifications)', () => {
    it('is the same soft panel, with a smaller title and less padding', () => {
      render(<PublicPageHero {...defaultProps} accent="amber" size="compact" />);
      const section = document.querySelector('[data-public-page-hero="true"]');
      const title = screen.getByRole('heading', { level: 1, name: 'Welcome to the Platform' });

      expect(section).toHaveAttribute('data-size', 'compact');
      expect(section?.className).toContain('bg-amber-500/10');
      expect(section?.className).toContain('py-5');
      expect(section?.className).not.toContain('sm:py-8');
      expect(title.className).toContain('text-2xl');
      expect(title.className).not.toContain('sm:text-4xl');
      expect(screen.getByText('Discover how timebanking works.').className).toContain('text-theme-secondary');
    });

    it('keeps its picture on phones too, where it is the only sign of what the page is', () => {
      render(<PublicPageHero {...defaultProps} size="compact" />);
      const tile = screen.getByTestId('test-icon').parentElement;
      expect(tile?.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    });

    // Warmth plan W7 (10 Nov 2026), measured at 375px wide: the notifications
    // opening took 288px of an 812px phone screen, settings 215px. On phones
    // a compact opening keeps its title, picture, description and buttons but
    // drops the small label above the title and some padding.
    it('is slimmer on phones: less padding, no small label above the title', () => {
      render(<PublicPageHero {...defaultProps} size="compact" />);
      const section = document.querySelector('[data-public-page-hero="true"]');
      expect(section?.className).toMatch(/(^|\s)py-4(\s|$)/);
      expect(section?.className).toContain('sm:py-5');
      expect(document.querySelector('[data-slot="chip"]')?.className).toContain('max-sm:hidden');
      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Welcome to the Platform' })).toBeInTheDocument();
    });

    it('keeps the small label on phones for a full-size opening', () => {
      render(<PublicPageHero {...defaultProps} />);
      expect(document.querySelector('[data-slot="chip"]')?.className).not.toContain('max-sm:hidden');
    });

    it('can open a page without the small label above the title', () => {
      render(<PublicPageHero {...defaultProps} eyebrow={undefined} size="compact" />);
      expect(document.querySelector('[data-slot="chip"]')).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: 'Welcome to the Platform' })).toBeInTheDocument();
    });

    it('can open a page without a description', () => {
      render(<PublicPageHero {...defaultProps} description={undefined} size="compact" />);
      expect(document.querySelector('[data-public-page-hero="true"] p')).toBeNull();
    });

    it('can make its heading the place focus moves to when a section opens', () => {
      render(<PublicPageHero {...defaultProps} size="compact" headingId="section-heading" headingFocusable />);
      const title = screen.getByRole('heading', { level: 1, name: 'Welcome to the Platform' });
      expect(title).toHaveAttribute('id', 'section-heading');
      expect(title).toHaveAttribute('tabindex', '-1');
      expect(title.className).toContain('focus-visible:outline-2');
    });

    // axe (9 Nov 2026): HeroUI's danger soft chip was 4.2:1 on the rose panel.
    it('deepens the label text on the status-coloured panels', () => {
      const { unmount } = render(<PublicPageHero {...defaultProps} accent="rose" />);
      expect(screen.getByText('Featured Section').closest('[data-slot="chip"]')?.className).toContain('text-rose-800!');
      unmount();
      render(<PublicPageHero {...defaultProps} accent="amber" />);
      expect(screen.getByText('Featured Section').closest('[data-slot="chip"]')?.className).toContain('text-amber-800!');
    });

    it('keeps the full size by default', () => {
      render(<PublicPageHero {...defaultProps} />);
      expect(document.querySelector('[data-public-page-hero="true"]')).toHaveAttribute('data-size', 'full');
      expect(screen.getByRole('heading', { level: 1 }).className).toContain('sm:text-4xl');
    });
  });

  it('shows a few of the people the page is about, as decoration', () => {
    render(
      <PublicPageHero
        title="Members"
        icon={<span />}
        people={[
          { id: 1, name: 'Maeve Byrne' },
          { id: 2, name: 'Tom Walsh' },
          { id: 3, name: 'Aoife' },
          { id: 4, name: 'Seán' },
          { id: 5, name: 'Niamh' },
          { id: 6, name: 'Pádraig' },
        ]}
      />,
    );
    // Five at most, and hidden from screen readers: the page lists them below.
    const faces = screen.getAllByTestId('hero-face');
    expect(faces).toHaveLength(5);
    expect(faces[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows no row of faces when there is no one to show', () => {
    render(<PublicPageHero title="Members" icon={<span />} people={[]} />);
    expect(screen.queryByTestId('hero-face')).toBeNull();
  });
});

describe('PublicPageHeroStrip — the phone-sized opening', () => {
  it('shows one line of text and a few faces, and no heading of its own', () => {
    render(
      <PublicPageHeroStrip
        text="Connect with members of the community"
        icon={<span />}
        people={[{ id: 1, name: 'Maeve' }, { id: 2, name: 'Tom' }, { id: 3, name: 'Aoife' }, { id: 4, name: 'Seán' }]}
      />,
    );
    expect(screen.getByText('Connect with members of the community')).toBeInTheDocument();
    expect(screen.getAllByTestId('hero-strip-face')).toHaveLength(3);
    // The page keeps its own <h1>; a second one here would give it two.
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
