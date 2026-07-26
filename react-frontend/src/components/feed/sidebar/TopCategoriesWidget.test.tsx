// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api (not used directly by this component but required by mocked contexts) ──
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

// tenantPath must be STABLE (not a new arrow per render) to avoid useEffect loops
// createMockContexts default already returns a fresh fn per call but this component
// only uses tenantPath at render time (not in a dep array), so it is safe.
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// The widget imports GlassCard from its DIRECT module path
// ('@/components/ui/GlassCard'), so an override on the '@/components/ui' barrel
// never applies — the real GlassCard loads either way and renders
//   <div class="card card--default glass-card p-4 …" data-slot="card">
const CARD = '.glass-card';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeCategories = () => [
  { id: 1, name: 'Gardening', count: 12 },
  { id: 2, name: 'Cooking', count: 8 },
  { id: 3, name: 'Childcare', count: 5 },
];

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('TopCategoriesWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when categories array is empty', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    const { container } = render(<TopCategoriesWidget categories={[]} />);
    // Component returns null for empty array
    expect(container.querySelector(CARD)).toBeNull();
    expect(screen.queryByText('Top Categories')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the widget card when categories are provided', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    const { container } = render(<TopCategoriesWidget categories={makeCategories()} />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card).toHaveClass('glass-card', 'p-4');
    // Heading and every category chip are nested INSIDE the card, not siblings of it.
    expect(card).toContainElement(screen.getByText('Top Categories'));
    screen.getAllByRole('link').forEach((link) => expect(card).toContainElement(link));
  });

  it('renders each category name', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={makeCategories()} />);
    expect(screen.getByText('Gardening')).toBeInTheDocument();
    expect(screen.getByText('Cooking')).toBeInTheDocument();
    expect(screen.getByText('Childcare')).toBeInTheDocument();
  });

  it('renders category count in parentheses', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={[{ id: 1, name: 'Gardening', count: 12 }]} />);
    expect(screen.getByText('(12)')).toBeInTheDocument();
  });

  it('each category is a link to the filtered listings page', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={[{ id: 7, name: 'Tutoring', count: 3 }]} />);
    const links = screen.getAllByRole('link');
    const categoryLink = links.find((l) => l.textContent?.includes('Tutoring'));
    expect(categoryLink).toBeInTheDocument();
    expect(categoryLink).toHaveAttribute('href', '/test/listings?category=7');
  });

  it('includes an "all listings" link', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={makeCategories()} />);
    const links = screen.getAllByRole('link');
    const allLink = links.find((l) => l.getAttribute('href') === '/test/listings');
    expect(allLink).toBeInTheDocument();
  });

  it('renders a heading for the widget', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={makeCategories()} />);
    // i18n key feed:sidebar.categories.title — English value expected
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Top Categories');
  });

  it('renders all category links using tenantPath', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    const cats = [
      { id: 10, name: 'Music', count: 2 },
      { id: 11, name: 'Sports', count: 7 },
    ];
    render(<TopCategoriesWidget categories={cats} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href')).filter(Boolean);
    expect(hrefs).toContain('/test/listings?category=10');
    expect(hrefs).toContain('/test/listings?category=11');
  });

  it('renders correct count for each category', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={[
      { id: 1, name: 'Cat A', count: 99 },
      { id: 2, name: 'Cat B', count: 1 },
    ]} />);
    expect(screen.getByText('(99)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('renders a single category correctly', async () => {
    const { TopCategoriesWidget } = await import('./TopCategoriesWidget');
    render(<TopCategoriesWidget categories={[{ id: 99, name: 'Elderly Care', count: 0 }]} />);
    expect(screen.getByText('Elderly Care')).toBeInTheDocument();
    expect(screen.getByText('(0)')).toBeInTheDocument();
  });
});
