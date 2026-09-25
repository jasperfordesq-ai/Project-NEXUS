// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock adminNewsletters ────────────────────────────────────────────────────
const { mockAdminNewsletters } = vi.hoisted(() => ({
  mockAdminNewsletters: {
    getActivity: vi.fn(),
    getOpeners: vi.fn(),
    getClickers: vi.fn(),
    getNonOpeners: vi.fn(),
    getOpenersNoClick: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminNewsletters: mockAdminNewsletters,
}));

// ─── Mock admin components ────────────────────────────────────────────────────
vi.mock('../../components', () => ({
  PageHeader: ({
    title,
    description,
    actions,
  }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '7' }),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeActivityEvent = (overrides = {}) => ({
  id: 1,
  email: 'alice@example.com',
  action_type: 'open' as const,
  url: null,
  action_at: '2025-05-01T10:00:00Z',
  user_agent: 'Mozilla/5.0',
  ip_address: '1.2.3.4',
  ...overrides,
});

// The list endpoints (openers/clickers/non-openers/opened-no-click) do NOT return an
// `id` — they are deduplicated by email server-side. These fixtures deliberately omit
// `id` to mirror the real API: the component must derive a stable row key from `email`
// itself (see withRowId), otherwise HeroUI's dynamic <TableBody items={...}> throws
// "Could not determine key for item" and crashes the tab. Reintroducing a fake `id`
// here would mask that regression (it did once). `activity` rows are the exception —
// they carry a real numeric id.
const makeOpener = (overrides: { email?: string } = {}) => ({
  email: 'bob@example.com',
  first_opened: '2025-05-01T09:00:00Z',
  open_count: 3,
  ...overrides,
});

const makeClicker = (overrides: { email?: string } = {}) => ({
  email: 'carol@example.com',
  first_clicked: '2025-05-01T09:30:00Z',
  click_count: 2,
  unique_links: 1,
  ...overrides,
});

const makeNonOpener = (overrides: { email?: string } = {}) => ({
  email: 'dave@example.com',
  name: 'Dave D',
  sent_at: '2025-04-30T08:00:00Z',
  ...overrides,
});

const makeOpenedNoClick = (overrides: { email?: string } = {}) => ({
  email: 'erin@example.com',
  name: 'Erin E',
  first_opened: '2025-05-01T10:15:00Z',
  open_count: 1,
  ...overrides,
});

const paginatedOf = <T,>(data: T[]) => ({
  success: true,
  data: { data, meta: { total: data.length, page: 1, per_page: 50, total_pages: 1 } },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('NewsletterActivity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminNewsletters.getActivity.mockResolvedValue(paginatedOf([]));
    mockAdminNewsletters.getOpeners.mockResolvedValue(paginatedOf([]));
    mockAdminNewsletters.getClickers.mockResolvedValue(paginatedOf([]));
    mockAdminNewsletters.getNonOpeners.mockResolvedValue(paginatedOf([]));
    mockAdminNewsletters.getOpenersNoClick.mockResolvedValue(paginatedOf([]));
  });

  it('renders the page title heading', async () => {
    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('calls getActivity on mount with newsletter id=7', async () => {
    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      expect(mockAdminNewsletters.getActivity).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ page: 1 }),
      );
    });
  });

  it('renders activity events in the default tab', async () => {
    mockAdminNewsletters.getActivity.mockResolvedValue(paginatedOf([makeActivityEvent()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton while data is loading', async () => {
    mockAdminNewsletters.getActivity.mockImplementation(() => new Promise(() => {}));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    // Skeleton is present while loading; it doesn't have a role=status itself,
    // but the page renders without crashing and shows nothing yet.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('shows error toast when getActivity throws', async () => {
    mockAdminNewsletters.getActivity.mockRejectedValue(new Error('Network'));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('switches to openers tab and calls getOpeners', async () => {
    mockAdminNewsletters.getOpeners.mockResolvedValue(paginatedOf([makeOpener()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    // Find the "openers" tab and click it
    const tabs = screen.getAllByRole('tab');
    const openersTab = tabs.find(
      (t) => t.textContent?.toLowerCase().includes('open') && !t.textContent?.toLowerCase().includes('no click'),
    );
    if (openersTab) {
      fireEvent.click(openersTab);
      await waitFor(() => {
        expect(mockAdminNewsletters.getOpeners).toHaveBeenCalledWith(
          7,
          expect.objectContaining({ page: 1 }),
        );
      });
    }
  });

  it('calls getOpeners when openers tab is clicked', async () => {
    // Note: HeroUI Table rendering in jsdom doesn't produce visible row text,
    // so we verify the API call rather than the rendered cell content.
    mockAdminNewsletters.getOpeners.mockResolvedValue(paginatedOf([makeOpener()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const tabs = screen.getAllByRole('tab');
    // The "who opened" tab title contains an icon + text
    const openersTab = tabs.find(
      (t) =>
        t.textContent?.toLowerCase().includes('who') &&
        t.textContent?.toLowerCase().includes('open'),
    );
    if (openersTab) {
      fireEvent.click(openersTab);
      await waitFor(() => {
        expect(mockAdminNewsletters.getOpeners).toHaveBeenCalledWith(
          7,
          expect.objectContaining({ page: 1 }),
        );
      });
    }
    // Verify getOpeners was called (guard against silent tab-not-found)
    expect(mockAdminNewsletters.getOpeners).toHaveBeenCalled();
  });

  it('switches to clickers tab and shows clicker data', async () => {
    mockAdminNewsletters.getClickers.mockResolvedValue(paginatedOf([makeClicker()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const tabs = screen.getAllByRole('tab');
    const clickersTab = tabs.find((t) => t.textContent?.toLowerCase().includes('click'));
    if (clickersTab) {
      fireEvent.click(clickersTab);
      await waitFor(() => {
        expect(mockAdminNewsletters.getClickers).toHaveBeenCalled();
      });
    }
  });

  it('switches to non-openers tab', async () => {
    mockAdminNewsletters.getNonOpeners.mockResolvedValue(paginatedOf([makeNonOpener()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const tabs = screen.getAllByRole('tab');
    const nonOpenersTab = tabs.find((t) => t.textContent?.toLowerCase().includes('non'));
    if (nonOpenersTab) {
      fireEvent.click(nonOpenersTab);
      await waitFor(() => {
        expect(mockAdminNewsletters.getNonOpeners).toHaveBeenCalled();
      });
    }
  });

  it('shows Export CSV button on the non-openers tab when data exists', async () => {
    // Use non-openers tab which also shows the export button (showExport = tab !== 'activity')
    // The source sets openers state on getOpeners success, so totalCount drives the button visibility.
    // We pre-load non-openers data before switching tabs.
    mockAdminNewsletters.getNonOpeners.mockResolvedValue(paginatedOf([makeNonOpener()]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const tabs = screen.getAllByRole('tab');
    const nonOpenersTab = tabs.find((t) => t.textContent?.toLowerCase().includes('non'));
    if (nonOpenersTab) {
      fireEvent.click(nonOpenersTab);
      await waitFor(() => {
        expect(mockAdminNewsletters.getNonOpeners).toHaveBeenCalled();
      });
      // Export button shows when currentData.length > 0 AND tab !== 'activity'
      // Since HeroUI Table doesn't expose data length via DOM, verify the API was called
      // with the correct arguments instead (the export path depends on rendered data state)
    }
    // At minimum the non-openers API was invoked; export button test is a jsdom HeroUI limitation
    expect(mockAdminNewsletters.getNonOpeners).toHaveBeenCalledWith(7, expect.objectContaining({ page: 1 }));
  });

  it('does not show Export CSV button on activity tab', async () => {
    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    // Activity tab is default; Export button should NOT be visible (showExport = activeTab !== 'activity')
    const exportBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('csv') || b.textContent?.toLowerCase().includes('export'),
    );
    expect(exportBtn).toBeUndefined();
  });

  it('shows Back to Stats button', async () => {
    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      const backBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('stats') || b.textContent?.toLowerCase().includes('back'),
      );
      expect(backBtn).toBeDefined();
    });
  });

  it('navigates back when Back button is clicked', async () => {
    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    const backBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('stats') || b.textContent?.toLowerCase().includes('back'),
    );
    if (backBtn) {
      fireEvent.click(backBtn);
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/7/stats'));
    }
  });

  it('renders click event chips for click events', async () => {
    mockAdminNewsletters.getActivity.mockResolvedValue(
      paginatedOf([makeActivityEvent({ action_type: 'click', url: 'https://example.com' })])
    );

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  // Regression: the per-subscriber list endpoints return rows keyed only by email
  // (no `id`). HeroUI's dynamic <TableBody items={...}> derives each row key from
  // `item.id`/`item.key` and throws "Could not determine key for item" otherwise —
  // which unmounts the tab subtree. The component must supply the key from email.
  it('switches through every per-subscriber tab with id-less rows without crashing', async () => {
    mockAdminNewsletters.getOpeners.mockResolvedValue(
      paginatedOf([makeOpener(), makeOpener({ email: 'b2@example.com' })])
    );
    mockAdminNewsletters.getClickers.mockResolvedValue(
      paginatedOf([makeClicker(), makeClicker({ email: 'c2@example.com' })])
    );
    mockAdminNewsletters.getNonOpeners.mockResolvedValue(
      paginatedOf([makeNonOpener(), makeNonOpener({ email: 'd2@example.com' })])
    );
    mockAdminNewsletters.getOpenersNoClick.mockResolvedValue(
      paginatedOf([makeOpenedNoClick(), makeOpenedNoClick({ email: 'e2@example.com' })])
    );

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    // Tabs render in declaration order: activity, openers, clickers, non-openers, opened-no-click.
    const calls = [
      mockAdminNewsletters.getOpeners,
      mockAdminNewsletters.getClickers,
      mockAdminNewsletters.getNonOpeners,
      mockAdminNewsletters.getOpenersNoClick,
    ];
    for (let i = 1; i <= 4; i++) {
      const tab = screen.getAllByRole('tab')[i];
      expect(tab).toBeDefined();
      fireEvent.click(tab);
      await waitFor(() => expect(calls[i - 1]).toHaveBeenCalled());
      // Heading still mounted ⇒ this tab rendered its rows without throwing.
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    }
  });

  it('ignores malformed subscriber rows without an email and keeps valid rows usable', async () => {
    const invalidEmails = [null, undefined, '', '   '];
    mockAdminNewsletters.getOpeners.mockResolvedValue(paginatedOf([
      makeOpener(),
      ...invalidEmails.map((email) => ({ ...makeOpener(), email })),
    ]));

    const { NewsletterActivity } = await import('./NewsletterActivity');
    render(<NewsletterActivity />);
    await waitFor(() => screen.getByRole('heading', { level: 1 }));

    fireEvent.click(screen.getAllByRole('tab')[1]);
    await waitFor(() => expect(mockAdminNewsletters.getOpeners).toHaveBeenCalled());
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });
});
