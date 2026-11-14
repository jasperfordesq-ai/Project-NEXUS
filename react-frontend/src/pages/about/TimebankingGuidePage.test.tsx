// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TimebankingGuidePage — how timebanking works, where it came from
 * and what it stands for (14 Nov 2026).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(),
  useAuth: vi.fn(),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation/Breadcrumbs', () => ({
  Breadcrumbs: () => <nav aria-label="breadcrumb" />,
}));
vi.mock('./RelatedPages', () => ({
  RelatedPages: ({ flush }: { flush?: boolean }) => (
    <div data-testid="related-pages" data-flush={String(Boolean(flush))} />
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

import { TimebankingGuidePage } from './TimebankingGuidePage';
import { useAuth, useTenant } from '@/contexts';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseTenant = useTenant as ReturnType<typeof vi.fn>;

/** Any community that is not hour-timebank. */
const someCommunity = (hasModule = true) => ({
  tenant: { id: 7, slug: 'riverside' },
  branding: { name: 'Riverside Timebank' },
  tenantPath: (p: string) => `/riverside${p}`,
  hasModule: vi.fn(() => hasModule),
});

const hourTimebank = () => ({
  tenant: { id: 2, slug: 'hour-timebank' },
  branding: { name: 'hOUR Timebank' },
  tenantPath: (p: string) => `/hour-timebank${p}`,
  hasModule: vi.fn(() => true),
});

const linksTo = (path: string) =>
  screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === path);

describe('TimebankingGuidePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, user: null });
    mockUseTenant.mockReturnValue(someCommunity());
  });

  it('opens with the breadcrumb and the page heading', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Timebanking Guide' })).toBeInTheDocument();
  });

  it('explains the three steps and the rule that every hour is worth the same', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByRole('heading', { name: 'Give an hour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Earn a time credit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spend it on help you need' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Everyone's hour is worth the same" })).toBeInTheDocument();
  });

  it('gives eight everyday examples of what people share', () => {
    render(<TimebankingGuidePage />);
    const examples = within(screen.getByTestId('guide-examples')).getAllByRole('listitem');
    expect(examples).toHaveLength(8);
    expect(examples[0]).toHaveTextContent('A lift to the shops');
  });

  // The owner asked for the origins of timebanking and Edgar Cahn on every
  // community's page (14 Nov 2026).
  describe('where timebanking comes from', () => {
    it('names Edgar Cahn, the years he lived and what he did', () => {
      render(<TimebankingGuidePage />);
      const origins = within(screen.getByTestId('guide-origins'));
      expect(origins.getByRole('heading', { name: /Edgar S\. Cahn/ })).toHaveTextContent('1935–2022');
      expect(origins.getByText(/founder of modern timebanking/)).toBeInTheDocument();
      expect(origins.getByText(/Jean Camper Cahn/)).toBeInTheDocument();
    });

    it('credits Teruko Mizushima, who tried the idea before him', () => {
      render(<TimebankingGuidePage />);
      const origins = within(screen.getByTestId('guide-origins'));
      expect(origins.getAllByText(/Teruko Mizushima/).length).toBeGreaterThan(0);
    });

    it('tells how the idea grew in six dated steps, ending with this community', () => {
      render(<TimebankingGuidePage />);
      const steps = within(screen.getByTestId('guide-origins')).getAllByRole('listitem');
      expect(steps).toHaveLength(6);
      expect(steps.map((step) => step.querySelector('p')?.textContent)).toEqual([
        '1973',
        '1980',
        '1992',
        '1995',
        '2000',
        'Today',
      ]);
      expect(steps[5]).toHaveTextContent('Riverside Timebank among them');
    });
  });

  it("lists Edgar Cahn's five values", () => {
    render(<TimebankingGuidePage />);
    const values = within(screen.getByTestId('guide-values'));
    expect(values.getAllByRole('listitem')).toHaveLength(5);
    for (const title of [
      'Everyone has something to give',
      'Some work is beyond price',
      'Helping goes both ways',
      'We need each other',
      'Respect for every person',
    ]) {
      expect(values.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  // The three figures are one timebank's (hOUR Timebank's 2023 study). Until
  // 14 Nov 2026 every community's page showed them as if they were true of
  // timebanking everywhere.
  describe('what the research found', () => {
    it('shows the three figures and says whose they are', () => {
      render(<TimebankingGuidePage />);
      const evidence = within(screen.getByTestId('guide-evidence'));
      expect(evidence.getByText('€16')).toBeInTheDocument();
      expect(evidence.getByText('100%')).toBeInTheDocument();
      expect(evidence.getByText('95%')).toBeInTheDocument();
      expect(evidence.getByText(/one timebank in Ireland, hOUR Timebank/)).toBeInTheDocument();
      expect(evidence.getByText(/These are one timebank's results/)).toBeInTheDocument();
    });

    // `/impact-summary` is wrapped in TenantSlugGate slug="hour-timebank".
    it('does not link to the full summary where that page does not exist', () => {
      render(<TimebankingGuidePage />);
      expect(screen.queryByRole('link', { name: /read the impact summary/i })).not.toBeInTheDocument();
    });

    it('links to the full summary for hour-timebank', () => {
      mockUseTenant.mockReturnValue(hourTimebank());
      render(<TimebankingGuidePage />);
      expect(screen.getByRole('link', { name: /read the impact summary/i })).toHaveAttribute(
        'href',
        '/hour-timebank/impact-summary',
      );
    });
  });

  it('answers four common questions', () => {
    render(<TimebankingGuidePage />);
    const questions = within(screen.getByTestId('guide-questions'));
    for (const question of [
      'Do I need a special skill?',
      'Is an hour really worth the same for everyone?',
      'Is it the same as volunteering?',
      'Does money change hands?',
    ]) {
      expect(questions.getByRole('button', { name: question })).toBeInTheDocument();
    }
  });

  describe('invitations', () => {
    it('invites a visitor to join, at the top and at the bottom', () => {
      render(<TimebankingGuidePage />);
      expect(linksTo('/riverside/register')).toHaveLength(2);
      expect(linksTo('/riverside/listings')).toHaveLength(0);
    });

    // A member reloading the page must not be asked to join while the sign-in
    // check is still running.
    it('does not invite anyone to join while the sign-in check is running', () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, user: null });
      render(<TimebankingGuidePage />);
      expect(linksTo('/riverside/register')).toHaveLength(0);
    });

    it('offers a signed-in member the offers and requests instead', () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, user: { id: 1 } });
      render(<TimebankingGuidePage />);
      expect(linksTo('/riverside/listings')).toHaveLength(1);
      expect(linksTo('/riverside/register')).toHaveLength(0);
    });

    it('does not offer the offers and requests where the community has them switched off', () => {
      mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, user: { id: 1 } });
      mockUseTenant.mockReturnValue(someCommunity(false));
      render(<TimebankingGuidePage />);
      expect(linksTo('/riverside/listings')).toHaveLength(0);
      expect(linksTo('/riverside/register')).toHaveLength(0);
    });

    it('always offers the help centre', () => {
      render(<TimebankingGuidePage />);
      expect(linksTo('/riverside/help')).toHaveLength(1);
    });

    // `/partner` is wrapped in TenantSlugGate slug="hour-timebank" in both route
    // files, so every other community is bounced off it. The button must only be
    // offered where the page exists — the same check the gate uses (tenant.slug).
    it('offers the partner page to the hour-timebank community', () => {
      mockUseTenant.mockReturnValue(hourTimebank());
      render(<TimebankingGuidePage />);
      expect(screen.getByRole('link', { name: /partner with us/i })).toHaveAttribute(
        'href',
        '/hour-timebank/partner',
      );
    });

    it('does not offer the partner page to any other community', () => {
      render(<TimebankingGuidePage />);
      expect(screen.queryByRole('link', { name: /partner with us/i })).not.toBeInTheDocument();
      expect(linksTo('/riverside/partner')).toHaveLength(0);
    });
  });

  it('shows the related pages inside its own margins', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByTestId('related-pages')).toHaveAttribute('data-flush', 'true');
  });
});
