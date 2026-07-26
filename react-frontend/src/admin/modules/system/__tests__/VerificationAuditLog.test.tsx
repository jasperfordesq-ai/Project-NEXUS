// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VerificationAuditLog admin component
 *
 * Tests:
 * - Renders with loading spinner initially
 * - Shows empty state when no events
 * - Renders event table with data
 * - Filter by event type works
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Common mocks ────────────────────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <>
      <MemoryRouter>{ui}</MemoryRouter>
    </>
  );
}

const mockAuditEvents = [
  {
    id: 1,
    user_id: 10,
    session_id: 100,
    event_type: 'verification_started',
    actor_type: 'user',
    actor_id: 10,
    details: '{"provider":"mock"}',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    created_at: '2026-03-07T10:00:00Z',
    first_name: 'Jane',
    last_name: 'Doe',
    user_email: 'jane@example.com',
  },
  {
    id: 2,
    user_id: 11,
    session_id: 101,
    event_type: 'verification_passed',
    actor_type: 'system',
    actor_id: null,
    details: null,
    ip_address: '10.0.0.1',
    user_agent: null,
    created_at: '2026-03-07T11:00:00Z',
    first_name: 'John',
    last_name: 'Smith',
    user_email: 'john@example.com',
  },
  {
    id: 3,
    user_id: 12,
    session_id: 102,
    event_type: 'admin_approved',
    actor_type: 'admin',
    actor_id: 1,
    details: '{"reason":"Looks good"}',
    ip_address: null,
    user_agent: null,
    created_at: '2026-03-07T12:00:00Z',
    first_name: null,
    last_name: null,
    user_email: 'anon@example.com',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VerificationAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with loading spinner initially', async () => {
    // Never resolve to keep loading state
    mockGet.mockReturnValue(new Promise(() => {}));

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    expect(screen.getByText('Verification Audit Log')).toBeTruthy();
    // HeroUI Spinner renders with role="status"
    expect(document.querySelector('[role="status"]') || document.querySelector('.animate-spinner-ease-spin')).toBeTruthy();
  });

  it('shows empty state when no events', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: [], total: 0 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('No audit events found.')).toBeTruthy();
    });
  });

  it('renders event table with data', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: mockAuditEvents, total: 3 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeTruthy();
    });

    // Check user names
    expect(screen.getByText('John Smith')).toBeTruthy();
    expect(screen.getByText('User #12')).toBeTruthy(); // null first/last name fallback

    // Check emails
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(screen.getByText('john@example.com')).toBeTruthy();

    // Check event type chips (also present in the filter Select options, so use getAllByText)
    expect(screen.getAllByText('Started').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Passed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Admin Approved').length).toBeGreaterThanOrEqual(1);

    // Check actor types. The Actor cell renders the translated
    // `verification.actor_type_*` label, not the raw DB enum (since e47a8a097),
    // so 'user' -> 'User', 'system' -> 'System', 'admin' -> 'Administrator'.
    // Asserted per-row against the Actor column: 'User' is also a column header,
    // and pinning label->row is stronger than a page-wide text search.
    const columnLabels = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim() ?? '');
    const actorColumn = columnLabels.indexOf('Actor');
    expect(actorColumn).toBeGreaterThanOrEqual(0);

    const actorCellText = (userName: string): string => {
      const row = screen.getByText(userName).closest('tr');
      expect(row).not.toBeNull();
      const cell = row?.children[actorColumn] as HTMLElement | undefined;
      return cell?.textContent?.trim() ?? '';
    };

    expect(actorCellText('Jane Doe')).toBe('User'); // actor_type: 'user'
    expect(actorCellText('John Smith')).toBe('System'); // actor_type: 'system'
    expect(actorCellText('User #12')).toBe('Administrator'); // actor_type: 'admin'

    // Check IP addresses
    expect(screen.getByText('192.168.1.1')).toBeTruthy();
    expect(screen.getByText('10.0.0.1')).toBeTruthy();

    // Check total events chip
    expect(screen.getByText('3 events')).toBeTruthy();

    // Check table headers. Matched by columnheader role rather than page-wide
    // text: 'User' now legitimately appears twice (header + Actor cell), and
    // this additionally pins each label to a real table column.
    expect(columnLabels).toEqual(['Time', 'User', 'Event', 'Actor', 'IP', 'Details']);
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Actor' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'IP' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Details' })).toBeTruthy();
  });

  it('renders parsed JSON details', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { events: [mockAuditEvents[0]], total: 1 },
    });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('provider: mock')).toBeTruthy();
    });
  });

  it('calls API with correct parameters', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: [], total: 0 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/admin/identity/audit-log')
      );
    });

    // Check default query params
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('limit=25')
    );
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('offset=0')
    );
  });

  it('renders refresh button', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: [], total: 0 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByLabelText('Refresh audit log')).toBeTruthy();
    });
  });

  it('renders filter dropdown', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: [], total: 0 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('No audit events found.')).toBeTruthy();
    });

    // The filter Select is identified by its accessible (aria) label.
    const selectTrigger = document.querySelector('[data-slot="trigger"]') ||
                          screen.getByLabelText('Filter verification events');
    expect(selectTrigger).toBeTruthy();
  });

  it('does not show pagination when total is less than page size', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: mockAuditEvents, total: 3 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeTruthy();
    });

    // With only 3 events and PAGE_SIZE=25, no pagination should show
    expect(screen.queryByText('Previous')).toBeFalsy();
    expect(screen.queryByText('Next')).toBeFalsy();
  });

  it('shows pagination when total exceeds page size', async () => {
    mockGet.mockResolvedValue({ success: true, data: { events: mockAuditEvents, total: 50 } });

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeTruthy();
    });

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('handles API failure silently', async () => {
    mockGet.mockRejectedValue(new Error('Server error'));

    const { default: VerificationAuditLog } = await import('../VerificationAuditLog');
    renderWithProviders(<VerificationAuditLog />);

    // After error, loading should stop and empty state should show
    await waitFor(() => {
      expect(screen.getByText('No audit events found.')).toBeTruthy();
    });
  });
});
