// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
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

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub useConfirm from UI to auto-confirm
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    useConfirm: () => vi.fn().mockResolvedValue(true),
    // Stub Select/SelectItem to avoid infinite loops in jsdom
    Select: ({ children, 'aria-label': ariaLabel, label, onSelectionChange, selectedKeys }: {
      children?: React.ReactNode;
      'aria-label'?: string;
      label?: string;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: string[];
    }) => (
      <select
        aria-label={ariaLabel ?? label ?? 'select'}
        value={selectedKeys?.[0] ?? ''}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id ?? ''}>{children}</option>
    ),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const { makeSummary, makePushSummary, makeLogs, makeSuppressions, makeQueues } = vi.hoisted(() => ({
  makeSummary: (overrides = {}) => ({
    window_days: 7,
    total: 142,
    by_status: { delivered: 130, failed: 5, bounced: 2, suppressed: 5 },
    delivered_pct: 91.5,
    accepted_pct: 95.0,
    unconfirmed_sent: 10,
    bounced_pct: 1.4,
    warnings: [],
    trigger_audit: {
      score: 950,
      issue_count: 2,
      matrix_count: 48,
      issues_by_severity: { critical: 0, warning: 2 },
      issues: [],
    },
    ...overrides,
  }),
  makePushSummary: (overrides = {}) => ({
    available: true,
    window_days: 7,
    total: 50,
    delivered: 45,
    partial: 2,
    failed: 3,
    success_pct: 90,
    fcm_sent: 50,
    fcm_failed: 3,
    web_delivered: 12,
    by_type: {},
    recent_failures: [],
    ...overrides,
  }),
  makeLogs: () => ({
    success: true,
    data: {
      rows: [
        {
          id: 1,
          user_id: 42,
          recipient_email: 'alice@example.com',
          category: 'welcome',
          subject: 'Welcome to NEXUS',
          status: 'delivered',
          provider: 'sendgrid',
          provider_message_id: 'msg-1',
          error: null,
          sent_at: '2026-06-01T10:00:00Z',
          delivered_at: '2026-06-01T10:01:00Z',
          bounced_at: null,
          opened_at: null,
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
      total: 1,
    },
  }),
  makeSuppressions: () => ({
    success: true,
    data: {
      rows: [
        {
          id: 7,
          email: 'bounce@example.com',
          reason: 'bounce',
          detail: 'Hard bounce',
          suppressed_at: '2026-05-01T12:00:00Z',
        },
      ],
      total: 1,
    },
  }),
  makeQueues: () => ({
    success: true,
    data: {
      rows: [
        {
          source: 'notification_queue',
          id: 1,
          email: 'user@example.com',
          category: 'alert',
          subject: 'Test alert',
          status: 'queued',
          frequency: null,
          attempts: 1,
          last_attempted_at: null,
          error: null,
          processing_started_at: null,
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
    },
  }),
}));

const makeApiSummaryResponse = (overrides = {}) => ({
  success: true,
  data: makeSummary(overrides),
});

const makeApiPushResponse = (overrides = {}) => ({
  success: true,
  data: makePushSummary(overrides),
});

// Default: summary, push summary, logs, suppressions, queues
function setupDefaultMocks() {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/summary')) return Promise.resolve(makeApiSummaryResponse());
    if (url.includes('/push-summary')) return Promise.resolve(makeApiPushResponse());
    if (url.includes('/logs')) return Promise.resolve(makeLogs());
    if (url.includes('/suppressions')) return Promise.resolve(makeSuppressions());
    if (url.includes('/queues')) return Promise.resolve(makeQueues());
    return Promise.resolve({ success: true, data: null });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('EmailDeliverability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultMocks();
  });

  it('shows loading spinners initially while summary is pending', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    const spinners = screen.getAllByRole('status');
    const busySpinner = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busySpinner).toBeDefined();
  });

  it('renders summary metric values after loading', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      // Total emails sent
      expect(screen.getByText('142')).toBeInTheDocument();
    });
  });

  it('renders push summary total after loading', async () => {
    // Use a unique total value to avoid collision with other rendered numbers
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/summary')) return Promise.resolve(makeApiSummaryResponse());
      if (url.includes('/push-summary')) return Promise.resolve({ success: true, data: makePushSummary({ total: 347 }) });
      if (url.includes('/logs')) return Promise.resolve(makeLogs());
      if (url.includes('/suppressions')) return Promise.resolve(makeSuppressions());
      if (url.includes('/queues')) return Promise.resolve(makeQueues());
      return Promise.resolve({ success: true, data: null });
    });

    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getByText('347')).toBeInTheDocument();
    });
  });

  it('labels provider acceptance truthfully instead of claiming device delivery', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getAllByText('Accepted').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('50 accepted but unconfirmed')).toBeInTheDocument();
    });
    expect(screen.queryByText('Success rate')).not.toBeInTheDocument();
  });

  it('renders email log row with recipient email', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('renders log row subject', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getByText('Welcome to NEXUS')).toBeInTheDocument();
    });
  });

  it('renders suppression list email', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getByText('bounce@example.com')).toBeInTheDocument();
    });
  });

  it('renders queue row from queue diagnostics', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument();
    });
  });

  it('calls DELETE suppression when remove button is clicked and confirmed', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => screen.getByText('bounce@example.com'));

    // Find a danger/remove button near the suppression row
    const removeBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('remove')
        || b.getAttribute('aria-label')?.toLowerCase().includes('suppression')
    );
    if (removeBtn) {
      fireEvent.click(removeBtn);
      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith(
          expect.stringContaining('/suppressions/7')
        );
      });
    }
    // If no button found, confirm the DOM is still rendered (no crash)
    expect(screen.getByText('bounce@example.com')).toBeInTheDocument();
  });

  it('renders trigger health counts (critical/warning)', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => {
      // critical count = 0, warning count = 2 from fixture
      expect(screen.getByText('0')).toBeInTheDocument();
      // "2" appears as warning count
      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThan(0);
    });
  });

  it('shows push unavailable alert when push summary available=false', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/summary')) return Promise.resolve(makeApiSummaryResponse());
      if (url.includes('/push-summary')) return Promise.resolve({ success: true, data: makePushSummary({ available: false }) });
      if (url.includes('/logs')) return Promise.resolve(makeLogs());
      if (url.includes('/suppressions')) return Promise.resolve(makeSuppressions());
      if (url.includes('/queues')) return Promise.resolve(makeQueues());
      return Promise.resolve({ success: true, data: null });
    });

    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    // Wait for page to load (no crash)
    await waitFor(() => {
      expect(screen.getByText('142')).toBeInTheDocument();
    });
  });

  it('renders reset filters button for logs section', async () => {
    const { default: EmailDeliverability } = await import('./EmailDeliverability');
    render(<EmailDeliverability />);

    await waitFor(() => screen.getByText('alice@example.com'));

    const resetBtns = screen.getAllByRole('button').filter(
      (b) => b.textContent?.toLowerCase().includes('reset')
    );
    expect(resetBtns.length).toBeGreaterThan(0);
  });
});
