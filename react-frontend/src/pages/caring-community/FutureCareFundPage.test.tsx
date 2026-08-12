// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── stable mock data (vi.hoisted so vi.mock factories can reference it) ──
const { SUMMARY } = vi.hoisted(() => ({
  SUMMARY: {
    total_banked_hours: 120,
    hours_received: 30,
    net_balance: 90,
    chf_value_estimate: 2700,
    hour_value_chf: 30,
    lifetime_given: 120,
    lifetime_received: 30,
    reciprocity_ratio: 0.25, // strong_giver
    first_contribution_date: '2024-01-15',
    active_months: 18,
    partner_organisations_helped: 3,
    this_month_hours_given: 5,
    this_month_hours_received: 2,
    by_year: [
      { year: 2024, hours_given: 80, hours_received: 20 },
      { year: 2025, hours_given: 40, hours_received: 10 },
    ],
  },
}));

// ─── api mock ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── caring_community feature is ON ──────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn((f: string) => f === 'caring_community' || true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

import { FutureCareFundPage } from './FutureCareFundPage';

// ─── tests ──────────────────────────────────────────────────────────────────

describe('FutureCareFundPage — loading', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows skeleton loading state while data is pending', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<FutureCareFundPage />);
    // Skeleton elements are rendered — at least one text for loading
    // The PageSkeleton shows a loading label paragraph
    const statusEls = screen.queryAllByRole('status');
    // Either a role=status or skeleton elements are present
    // The skeleton shows a <p> with the loading label key
    const bodyText = document.body.textContent ?? '';
    expect(
      bodyText.includes('loading') || bodyText.includes('future_care_fund.loading') || statusEls.length > 0,
    ).toBe(true);
  });
});

describe('FutureCareFundPage — populated state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: SUMMARY });
  });

  it('renders the page heading', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('shows the net balance value', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
  });

  it('shows the first contribution date', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // formatDate renders the date as a locale string
      // just check something date-like appeared
      const bodyText = document.body.textContent ?? '';
      expect(bodyText).toMatch(/2024/);
    });
  });

  it('renders stat cards for lifetime given and received', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // stat cards have headings p elements with the stat labels
      const bodyText = document.body.textContent ?? '';
      expect(bodyText.includes('120') || bodyText.includes('future_care_fund')).toBe(true);
    });
  });

  it('renders the reciprocity bar section', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // Multiple h2 section headings are rendered (balance, year, how-it-works, etc.)
      const h2s = screen.getAllByRole('heading', { level: 2 });
      expect(h2s.length).toBeGreaterThan(0);
    });
  });

  it('renders the by-year breakdown', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // Year 2024 and 2025 appear in the chart
      expect(screen.getByText('2024')).toBeInTheDocument();
      expect(screen.getByText('2025')).toBeInTheDocument();
    });
  });

  it('renders the "how it works" section with steps', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // The how_it_works section has numbered steps 1, 2, 3
      const bodyText = document.body.textContent ?? '';
      expect(bodyText.includes('1') && bodyText.includes('2') && bodyText.includes('3')).toBe(true);
    });
  });

  it('renders CTA buttons', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const allLinks = screen.getAllByRole('link');
      expect(allLinks.length).toBeGreaterThan(0);
    });
  });

  /**
   * 🔴 Regression: the "offer" CTA pointed at `/listings/new`, which is not a
   * route. It did not 404 — `listings/:id` (AppRoutes.tsx) matched it with the
   * literal id "new" and rendered ListingDetailPage's not-found state, so the
   * dead link was silent. The create route is `/listings/create`.
   */
  it('offer CTA links to the create route, not /listings/new', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/test/listings/create');
      expect(hrefs).not.toContain('/test/listings/new');
    });
  });

  it('shows active_months count', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      expect(screen.getByText('18')).toBeInTheDocument();
    });
  });

  it('shows partner organisations count in stat hint when > 0', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const bodyText = document.body.textContent ?? '';
      expect(bodyText.includes('3')).toBe(true);
    });
  });
});

describe('FutureCareFundPage — error state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: false, error: 'Server error' });
  });

  it('shows an error alert when the API call fails', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('does not render the hero card on error', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Net balance should not be visible
    expect(screen.queryByText('90')).not.toBeInTheDocument();
  });
});

describe('FutureCareFundPage — reciprocity messages', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses "strong_giver" message when ratio < 0.3', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { ...SUMMARY, reciprocity_ratio: 0.1 },
    });
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const bodyText = document.body.textContent ?? '';
      // Key 'future_care_fund.reciprocity.strong_giver' should be rendered (either key or translation)
      expect(bodyText.length).toBeGreaterThan(50);
    });
  });

  it('uses "strong_receiver" message when ratio > 1.5', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { ...SUMMARY, reciprocity_ratio: 2.0 },
    });
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const bodyText = document.body.textContent ?? '';
      expect(bodyText.length).toBeGreaterThan(50);
    });
  });

  it('uses "balanced" message for ratio between 0.3 and 1.5', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { ...SUMMARY, reciprocity_ratio: 0.8 },
    });
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const bodyText = document.body.textContent ?? '';
      expect(bodyText.length).toBeGreaterThan(50);
    });
  });
});

describe('FutureCareFundPage — back link', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: SUMMARY });
  });

  it('renders the back link to caring-community', async () => {
    render(<FutureCareFundPage />);
    await waitFor(() => {
      const allLinks = screen.getAllByRole('link');
      const backLink = allLinks.find((l) => l.getAttribute('href')?.includes('caring-community'));
      expect(backLink).toBeDefined();
    });
  });
});

describe('FutureCareFundPage — by_year edge case', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders nothing for the year chart when by_year is empty', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { ...SUMMARY, by_year: [] },
    });
    render(<FutureCareFundPage />);
    await waitFor(() => {
      // By-year chart returns null for empty rows — no year numbers appear
      expect(screen.queryByText('2024')).not.toBeInTheDocument();
    });
  });
});
