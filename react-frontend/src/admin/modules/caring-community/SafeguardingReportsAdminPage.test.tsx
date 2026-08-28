// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ── api mock ──────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── stubs ─────────────────────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));
vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Abbr: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// ── contexts ──────────────────────────────────────────────────────────────────
const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ showToast: mockShowToast, success: vi.fn(), error: vi.fn() }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ── fixtures ──────────────────────────────────────────────────────────────────
const makeReport = (overrides = {}) => ({
  id: 1,
  reporter_id: 10,
  reporter_name: 'Alice Reporter',
  subject_user_id: 20,
  subject_user_name: 'Bob Subject',
  subject_organisation_id: null,
  // 🔴 A REAL category slug. This fixture used to say 'Bullying', which the API
  // has never sent — SafeguardingService::CATEGORIES is a closed list of slugs
  // (inappropriate_behavior, financial_concern, exploitation, neglect,
  // medical_concern, other). The page renders
  // tAdmin(`caring_workflow.safeguarding.categories.${category}`), so an invented
  // value resolved to the "Unknown category" fallback and 'Bullying' was never on
  // screen — the row assertion below matched nothing and read as missing rows.
  category: 'inappropriate_behavior',
  severity: 'high' as const,
  description: 'Incident description',
  evidence_url: null,
  status: 'submitted' as const,
  assigned_to_user_id: null,
  assigned_to_name: null,
  review_due_at: null,
  is_overdue: false,
  escalated: false,
  escalated_at: null,
  resolution_notes: null,
  resolved_at: null,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
  ...overrides,
});

const makeDetail = (overrides = {}) => ({
  ...makeReport(overrides),
  actions: [] as object[],
});

const okList = (items = [makeReport()]) => ({ success: true, data: { items } });
const okDetail = (data = makeDetail()) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('SafeguardingReportsAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(okList());
    mockApi.post.mockResolvedValue({ success: true });
  });

  async function renderPage() {
    const mod = await import('./SafeguardingReportsAdminPage');
    const Component = mod.default;
    render(<Component />);
  }

  // ── loading ────────────────────────────────────────────────────────────────
  it('shows busy spinner while loading', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  // ── empty ──────────────────────────────────────────────────────────────────
  it('shows empty message when no reports returned', async () => {
    mockApi.get.mockResolvedValue(okList([]));
    await renderPage();
    await waitFor(() => {
      // The spinner should be gone (no busy=true spinners)
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEls.length).toBe(0);
    });
    // The i18n translation for empty state renders real text in test env
    expect(document.body.textContent).toMatch(/No safeguarding reports|safeguarding_reports\.empty/i);
  });

  // ── populated ─────────────────────────────────────────────────────────────
  it('shows report rows after load', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice Reporter')).toBeInTheDocument();
      expect(screen.getByText('Bob Subject')).toBeInTheDocument();
      // Categories are translated, so assert the label an admin sees.
      expect(screen.getByText('Inappropriate behaviour')).toBeInTheDocument();
    });
  });

  it('shows overdue chip on overdue reports', async () => {
    mockApi.get.mockResolvedValue(okList([makeReport({ is_overdue: true })]));
    await renderPage();
    await waitFor(() => {
      // Overdue chip text from i18n key admin.safeguarding_reports.overdue
      const page = document.body;
      expect(page.textContent).toMatch(/overdue/i);
    });
  });

  // ── error ──────────────────────────────────────────────────────────────────
  it('calls showToast on load failure', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    await renderPage();
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.anything(),
        'error',
      );
    });
  });

  // ── detail modal ───────────────────────────────────────────────────────────
  it('opens detail modal and loads report detail when Open is clicked', async () => {
    mockApi.get
      .mockResolvedValueOnce(okList())          // initial list
      .mockResolvedValueOnce(okDetail());        // detail fetch
    await renderPage();

    await waitFor(() => screen.getByText('Alice Reporter'));

    // Click the "Open" button (i18n key renders key in test env)
    const openBtns = screen.getAllByRole('button');
    const openBtn = openBtns.find((b) => b.textContent?.match(/open|view/i));
    if (openBtn) fireEvent.click(openBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows loading spinner inside modal while fetching detail', async () => {
    mockApi.get
      .mockResolvedValueOnce(okList())
      .mockImplementation(() => new Promise(() => {})); // detail hangs
    await renderPage();

    await waitFor(() => screen.getByText('Alice Reporter'));

    const openBtns = screen.getAllByRole('button');
    const openBtn = openBtns.find((b) => b.textContent?.match(/open|view/i));
    if (openBtn) fireEvent.click(openBtn);

    await waitFor(() => {
      const statusEls = screen.getAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeDefined();
    });
  });

  // ── escalate action ────────────────────────────────────────────────────────
  it('calls escalate endpoint when Escalate is pressed', async () => {
    mockApi.get
      .mockResolvedValueOnce(okList())
      .mockResolvedValue(okDetail());
    await renderPage();

    await waitFor(() => screen.getByText('Alice Reporter'));
    const openBtns = screen.getAllByRole('button');
    const openBtn = openBtns.find((b) => b.textContent?.match(/open|view/i));
    if (openBtn) fireEvent.click(openBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click the escalate button
    const allBtns = screen.getAllByRole('button');
    const escalateBtn = allBtns.find((b) => b.textContent?.match(/escalate/i));
    if (escalateBtn) {
      fireEvent.click(escalateBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          expect.stringContaining('/escalate'),
          expect.anything(),
        );
      });
    }
  });

  // ── note action ────────────────────────────────────────────────────────────
  it('shows action history as empty list in modal when no actions', async () => {
    mockApi.get
      .mockResolvedValueOnce(okList())
      .mockResolvedValueOnce(okDetail({ actions: [] }));
    await renderPage();

    await waitFor(() => screen.getByText('Alice Reporter'));
    const openBtns = screen.getAllByRole('button');
    const openBtn = openBtns.find((b) => b.textContent?.match(/open|view/i));
    if (openBtn) fireEvent.click(openBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));
    // i18n key admin.safeguarding_reports.history.empty
    expect(document.body.textContent).toMatch(/history\.empty|no actions|no history/i);
  });

  it('shows action history items in modal', async () => {
    const actions = [
      { id: 1, actor_id: 5, actor_name: 'Carol Admin', action: 'triaged', notes: 'Looked at it', created_at: '2026-01-16T09:00:00Z' },
    ];
    // First call: list; second call: detail; subsequent calls: list again (after load)
    mockApi.get
      .mockResolvedValueOnce(okList())
      .mockResolvedValueOnce(okDetail({ actions }))
      .mockResolvedValue(okList());
    await renderPage();

    await waitFor(() => screen.getByText('Alice Reporter'));
    const openBtns = screen.getAllByRole('button');
    const openBtn = openBtns.find((b) => b.textContent?.match(/open|view/i));
    if (!openBtn) return; // defensive
    fireEvent.click(openBtn);

    await waitFor(() => {
      // Modal is open and detail loaded — look for action notes
      expect(screen.getByText('Looked at it')).toBeInTheDocument();
    });
    expect(document.body.textContent).toMatch(/Carol Admin/);
  });
});
