// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TimebankingGuidePage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenantPath: (p: string) => `/test${p}`,
  })),
  useAuth: vi.fn(() => ({
    isAuthenticated: false,
    user: null,
  })),

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
  RelatedPages: () => <div data-testid="related-pages" />,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
    h1: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <h1 {...rest}>{children}</h1>;
    },
    p: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <p {...rest}>{children}</p>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { TimebankingGuidePage } from './TimebankingGuidePage';
import { useAuth } from '@/contexts';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

describe('TimebankingGuidePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
  });

  it('renders without crashing', () => {
    render(<TimebankingGuidePage />);
    expect(document.body).toBeInTheDocument();
  });

  it('renders breadcrumb navigation', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
  });

  it('renders impact statistics', () => {
    render(<TimebankingGuidePage />);
    // Impact stats: 16:1, 100%, 95%
    expect(screen.getByText('16:1')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('renders the three "How It Works" steps', () => {
    render(<TimebankingGuidePage />);
    // Step titles from the steps data
    expect(screen.getByText('Give an Hour')).toBeInTheDocument();
    expect(screen.getByText('Earn a Credit')).toBeInTheDocument();
    expect(screen.getByText('Get Help')).toBeInTheDocument();
  });

  it('renders the four fundamental values', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByText('We Are All Assets')).toBeInTheDocument();
    expect(screen.getByText('Redefining Work')).toBeInTheDocument();
    expect(screen.getByText('Reciprocity')).toBeInTheDocument();
    expect(screen.getByText('Social Networks')).toBeInTheDocument();
  });

  // 🔴 These CTAs are LINKS, not buttons. The page renders `<Button as={Link}>`,
  // which produces an <a href> whose implicit ARIA role is `link` — the right
  // element for something that navigates. The old queries asked for role
  // "button", so they matched nothing and read as missing CTAs.
  //
  // (They were written for the '@/components/ui' uiMock, whose Button stub does
  // render a <button href=…>. That mock never installed: the page imports Button
  // from '@/components/ui/Button', its own path, so the real Button loads.)
  const ctaLinksTo = (path: string) =>
    screen.getAllByRole('link').filter(a => a.getAttribute('href')?.includes(path));

  it('shows register CTA when user is not authenticated', () => {
    render(<TimebankingGuidePage />);
    expect(ctaLinksTo('/register').length).toBeGreaterThan(0);
  });

  it('shows listings CTA when user is authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 1 } });
    render(<TimebankingGuidePage />);
    expect(ctaLinksTo('/listings').length).toBeGreaterThan(0);
  });

  it('renders the partner CTA', () => {
    render(<TimebankingGuidePage />);
    expect(ctaLinksTo('/partner').length).toBeGreaterThan(0);
  });

  it('renders the related pages section', () => {
    render(<TimebankingGuidePage />);
    expect(screen.getByTestId('related-pages')).toBeInTheDocument();
  });
});
