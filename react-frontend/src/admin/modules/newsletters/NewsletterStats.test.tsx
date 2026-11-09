// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminNewsletters } = vi.hoisted(() => ({
  mockAdminNewsletters: {
    getStats: vi.fn(),
    getEmailClients: vi.fn(),
    selectAbWinner: vi.fn(),
    duplicateNewsletter: vi.fn(),
  },
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockNavigate = vi.hoisted(() => vi.fn());

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// PageMeta already mocked globally in setup.ts

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '7' }),
  };
});

vi.mock('../../api/adminApi', () => ({
  adminNewsletters: mockAdminNewsletters,
}));

// Stub recharts to avoid SVG rendering issues in JSDOM
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
}));

vi.mock('@/lib/chartColors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chartColors')>()),
  CHART_TOKEN_COLORS: {
    primary: '#006FEE',
    success: '#17c964',
    warning: '#f5a524',
    muted: '#71717a',
    surface: '#ffffff',
    border: '#e4e4e7',
  },
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title, actions, description }: { title: string; actions?: React.ReactNode; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

// NewsletterStats imports StatCard from the direct path ('../../components/StatCard'),
// not the barrel above — so the StatCard stub must be registered against that exact
// specifier or vi.mock never intercepts it and the real (testid-less) StatCard renders.
vi.mock('../../components/StatCard', () => ({
  StatCard: ({ label, value }: { label?: string; title?: string; value: string | number }) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('./NewsletterResend', () => ({
  NewsletterResend: ({ isOpen }: { isOpen: boolean; onClose: () => void; newsletterId: number; onSuccess: () => void }) =>
    isOpen ? <div data-testid="resend-modal">Resend Modal</div> : null,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeStatsData = (overrides: Partial<Record<string, unknown>> = {}) => ({
  newsletter: {
    id: 7,
    name: 'Monthly Update',
    subject: 'Monthly Community Update',
    subject_b: null,
    status: 'sent',
    ab_test_enabled: false,
    ab_winner: null,
    ab_winner_metric: 'opens',
    created_by: 1,
    author_name: 'Admin',
    sent_at: '2025-05-01T10:00:00Z',
    created_at: '2025-04-30T09:00:00Z',
  },
  delivery: {
    total_sent: 500,
    delivered: 490,
    failed: 5,
    bounced: 3,
    pending: 2,
  },
  engagement: {
    unique_opens: 245,
    total_opens: 300,
    unique_clicks: 80,
    total_clicks: 120,
    open_rate: 50,
    click_rate: 16,
    click_to_open_rate: 33,
    success_rate: 98,
  },
  ab_test: null,
  timeline: [],
  top_links: [],
  device_stats: { desktop: 150, mobile: 90, tablet: 5, unknown: 0 },
  recent_activity: [],
  peak_engagement: { max_opens_per_hour: 45, peak_hour: 2 },
  ...overrides,
});

const makeSuccessResponse = (data: object) => ({ success: true, data });

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('NewsletterStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminNewsletters.getStats.mockResolvedValue(makeSuccessResponse(makeStatsData()));
    mockAdminNewsletters.getEmailClients.mockResolvedValue({ success: true, data: { email_clients: [] } });
    mockAdminNewsletters.selectAbWinner.mockResolvedValue({ success: true });
    mockAdminNewsletters.duplicateNewsletter.mockResolvedValue({ success: true });
  });

  it('shows loading state initially when API is pending', async () => {
    mockAdminNewsletters.getStats.mockReturnValue(new Promise(() => {}));
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // During loading the stat content isn't rendered yet
    expect(screen.queryByText('Monthly Community Update')).not.toBeInTheDocument();
  });

  it('renders newsletter subject as heading after load', async () => {
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      // The subject appears in the PageHeader title (and possibly elsewhere); getAllByText handles multiples
      const els = screen.getAllByText('Monthly Community Update');
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('renders delivery stat cards', async () => {
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows not found error when getStats returns failure', async () => {
    mockAdminNewsletters.getStats.mockResolvedValue({ success: false });
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      // "Not Found error" is English for newsletters.error_not_found
      const text = screen.queryByText('Not Found error') ||
        screen.queryByText(/not found/i);
      expect(text).toBeInTheDocument();
    });
  });

  it('shows inline error when API throws', async () => {
    mockAdminNewsletters.getStats.mockRejectedValue(new Error('network error'));
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // The component catches the throw and calls setError() — rendered inline, NOT toast.error
    await waitFor(() => {
      const errorEl = screen.queryByText(/failed to load stats/i) ||
        screen.queryByText(/error/i);
      expect(errorEl).toBeInTheDocument();
    });
  });

  it('renders A/B test section when ab_test data is present', async () => {
    const abTestData = makeStatsData({
      newsletter: {
        id: 7,
        name: 'AB Test Newsletter',
        subject: 'Subject A - Original',
        subject_b: 'Subject B - Alternative',
        status: 'sent',
        ab_test_enabled: true,
        ab_winner: null,
        ab_winner_metric: 'opens',
        created_by: 1,
        author_name: 'Admin',
        sent_at: '2025-05-01T10:00:00Z',
        created_at: '2025-04-30T09:00:00Z',
      },
      ab_test: {
        subject_a: 'Subject A - Original',
        subject_b: 'Subject B - Alternative',
        subject_a_opens: 120,
        subject_a_clicks: 30,
        subject_b_opens: 100,
        subject_b_clicks: 25,
        subject_a_sent: 250,
        subject_b_sent: 250,
        subject_a_open_rate: 48,
        subject_b_open_rate: 40,
        subject_a_click_rate: 12,
        subject_b_click_rate: 10,
        split_percentage: 50,
        winner_metric: 'opens',
        winner: null,
        winning_margin: 8,
      },
    });
    mockAdminNewsletters.getStats.mockResolvedValue(makeSuccessResponse(abTestData));

    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      // "Ab Test Results" is English for newsletters.section_ab_test_results
      expect(screen.getByText('Ab Test Results')).toBeInTheDocument();
    });
    // Both subject variants should be visible
    expect(screen.getByText('"Subject A - Original"')).toBeInTheDocument();
    expect(screen.getByText('"Subject B - Alternative"')).toBeInTheDocument();
  });

  it('calls selectAbWinner API when Select A as Winner is clicked', async () => {
    const abTestData = makeStatsData({
      ab_test: {
        subject_a: 'A', subject_b: 'B',
        subject_a_opens: 120, subject_a_clicks: 30,
        subject_b_opens: 100, subject_b_clicks: 25,
        subject_a_sent: 250, subject_b_sent: 250,
        subject_a_open_rate: 48, subject_b_open_rate: 40,
        subject_a_click_rate: 12, subject_b_click_rate: 10,
        split_percentage: 50, winner_metric: 'opens', winner: null, winning_margin: 8,
      },
    });
    mockAdminNewsletters.getStats.mockResolvedValue(makeSuccessResponse(abTestData));

    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // "Select a as Winner" is English for newsletters.select_a_as_winner
    await waitFor(() => screen.getByText('Select a as Winner'));

    const selectABtn = screen.getByText('Select a as Winner').closest('button') ||
      screen.getAllByRole('button').find((b) => b.textContent?.includes('Select a as Winner'));
    if (selectABtn) fireEvent.click(selectABtn);

    await waitFor(() => {
      expect(mockAdminNewsletters.selectAbWinner).toHaveBeenCalledWith(7, 'a');
    });
  });

  it('renders top links table when top_links data is present', async () => {
    const statsWithLinks = makeStatsData({
      top_links: [
        { url: 'https://example.com/page1', clicks: 55, unique_clicks: 40 },
        { url: 'https://example.com/page2', clicks: 20, unique_clicks: 18 },
      ],
    });
    mockAdminNewsletters.getStats.mockResolvedValue(makeSuccessResponse(statsWithLinks));

    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // "Top Clicked Links" is English for newsletters.section_top_clicked_links
    await waitFor(() => {
      expect(screen.getByText('Top Clicked Links')).toBeInTheDocument();
    });
    expect(screen.getByText('https://example.com/page1')).toBeInTheDocument();
  });

  it('calls duplicateNewsletter API when Duplicate Newsletter button is clicked', async () => {
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // "Duplicate Newsletter" is English for newsletters.btn_duplicate_newsletter
    await waitFor(() => screen.getByText('Duplicate Newsletter'));

    const dupBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Duplicate Newsletter')
    );
    if (dupBtn) fireEvent.click(dupBtn);

    await waitFor(() => {
      expect(mockAdminNewsletters.duplicateNewsletter).toHaveBeenCalledWith(7);
    });
  });

  it('shows resend button for sent newsletters with non-openers', async () => {
    // non-openers = delivered (490) - unique_opens (245) = 245 > 0
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      const resendBtn = screen.getAllByRole('button').find((b) =>
        // "Resend to Non Openers Count" or similar English string
        b.textContent?.toLowerCase().includes('resend') ||
        b.textContent?.includes('Non')
      );
      expect(resendBtn).toBeDefined();
    });
  });

  it('shows device breakdown section', async () => {
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    // "Devices" is English for newsletters.section_devices
    await waitFor(() => {
      expect(screen.getByText('Devices')).toBeInTheDocument();
    });
  });

  it('calls getStats on mount with newsletter id from params', async () => {
    const { NewsletterStats } = await import('./NewsletterStats');
    render(<NewsletterStats />);

    await waitFor(() => {
      expect(mockAdminNewsletters.getStats).toHaveBeenCalledWith(7);
    });
  });
});
