// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Hoist mock objects so factory closures see them ─────────────────────────
const { mockBroker, mockAdminUsers, mockConfirm } = vi.hoisted(() => ({
  mockBroker: {
    getMonitoring: vi.fn(),
    setMonitoring: vi.fn(),
  },
  mockAdminUsers: {
    list: vi.fn(),
    get: vi.fn(),
  },
  mockConfirm: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockBroker,
  adminUsers: mockAdminUsers,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// The shared confirm dialog needs its provider; the page only needs the answer.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return { ...orig, useConfirm: () => mockConfirm };
});

// ─── Toast + tenant mock ──────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

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

// ─── Stub admin components ────────────────────────────────────────────────────
// The DataTable stub executes each column's render() so cell content
// (avatars, chips, countdowns, row actions) is exercised by the tests.
type StubColumn = { key: string; render?: (item: unknown) => React.ReactNode };

vi.mock('@/admin/components', () => ({
  DataTable: ({
    data,
    columns,
    isLoading,
    emptyContent,
  }: {
    data: Array<Record<string, unknown>>;
    columns: StubColumn[];
    isLoading: boolean;
    emptyContent?: React.ReactNode;
  }) => (
    <div data-testid="data-table" data-loading={String(isLoading)}>
      {data.length === 0 ? emptyContent : null}
      {data.map((item) => (
        <div key={String(item.user_id)} data-testid="data-table-row">
          {columns.map((col) => (
            <div key={col.key} data-testid={`cell-${col.key}`}>
              {col.render ? col.render(item) : String(item[col.key] ?? '')}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  ConfirmModal: ({
    isOpen,
    onConfirm,
    onClose,
    title,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
  // The shared member picker has its own suite; a click picks member 7.
  MemberSearchPicker: ({ label, value, onValueChange }: { label: string; value: string; onValueChange: (v: string) => void }) => (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => onValueChange('7')}>pick member 7</button>
      <span data-testid="picked-member">{value}</span>
    </div>
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (u: string | null) => u ?? '',
  };
});
vi.mock('@/lib/serverTime', () => ({
  parseServerTimestamp: (v: string | null) => (v ? new Date(v) : null),
  formatServerDate: (v: string) => v,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

const makeMonitoredUser = (overrides = {}) => ({
  user_id: 10,
  user_name: 'Bob Suspect',
  under_monitoring: true,
  messaging_disabled: false,
  monitoring_reason: 'Suspicious activity',
  monitoring_started_at: '2025-01-01T00:00:00Z',
  monitoring_expires_at: null,
  ...overrides,
});

const threeMembers = () => [
  makeMonitoredUser({ user_id: 1, user_name: 'User One' }),
  makeMonitoredUser({ user_id: 2, user_name: 'User Two', messaging_disabled: true, monitoring_reason: 'Spam reports' }),
  makeMonitoredUser({
    user_id: 3,
    user_name: 'User Three',
    monitoring_expires_at: new Date(Date.now() + 3 * DAY_MS).toISOString(),
  }),
];

/** Render at a URL (the page reads ?tab= from the real router). */
async function renderAt(url: string) {
  window.history.pushState({}, '', url);
  const { UserMonitoring } = await import('./UserMonitoringPage');
  return render(<UserMonitoring />);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('UserMonitoring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: [] });
    mockBroker.setMonitoring.mockResolvedValue({ success: true });
    mockAdminUsers.list.mockResolvedValue({ success: true, data: [] });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a loading skeleton while fetching monitored users', async () => {
    mockBroker.getMonitoring.mockImplementationOnce(() => new Promise(() => {}));
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      const statusEls = screen.getAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeTruthy();
    });
    // The table itself only renders once data has arrived
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });

  it('renders the page header title', async () => {
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'User Monitoring' })
    ).toBeInTheDocument();
  });

  it('shows the reassuring all-clear state when nobody is monitored', async () => {
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText('Nobody is under monitoring')).toBeInTheDocument();
    });
  });

  it('shows error toast when getMonitoring fails', async () => {
    mockBroker.getMonitoring.mockRejectedValue(new Error('network'));
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows an honest error state with a retry button on load failure', async () => {
    mockBroker.getMonitoring.mockRejectedValue(new Error('network'));
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load monitored members")).toBeInTheDocument();
    });
    // A failed load must never render as an all-clear queue
    expect(screen.queryByText('Nobody is under monitoring')).not.toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockBroker.getMonitoring).toHaveBeenCalledTimes(2);
    });
  });

  it('renders monitored user rows when data is returned', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [makeMonitoredUser()],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText('Bob Suspect')).toBeInTheDocument();
    });
    // Reason is readable in the row, not hidden behind a tooltip
    expect(screen.getByText('Suspicious activity')).toBeInTheDocument();
  });

  it('member names open the panel-wide member window', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: [makeMonitoredUser()] });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    expect(await screen.findByRole('button', { name: "Open Bob Suspect's record" })).toBeInTheDocument();
  });

  it('derives the KPI header from the loaded list, and each card links to its tab', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: threeMembers() });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
    });

    const totalLabel = screen.getByText('Under monitoring');
    expect(totalLabel.parentElement?.textContent).toContain('3');

    // KPI label + the row chip both use the shared "Messaging disabled" string
    const disabledLabels = screen.getAllByText('Messaging disabled');
    expect(disabledLabels.length).toBeGreaterThanOrEqual(2);
    expect(disabledLabels[0].parentElement?.textContent).toContain('1');

    const expiringLabel = screen.getByText('Expiring within 7 days');
    expect(expiringLabel.parentElement?.textContent).toContain('1');

    expect(screen.getByRole('link', { name: 'Messaging disabled' })).toHaveAttribute('href', '/test/broker/monitoring?tab=messaging_off');
    expect(screen.getByRole('link', { name: 'Expiring within 7 days' })).toHaveAttribute('href', '/test/broker/monitoring?tab=expiring_soon');
    expect(screen.getByRole('link', { name: 'Under monitoring' })).toHaveAttribute('href', '/test/broker/monitoring');
  });

  // ─── Tabs and search over the loaded rows ──────────────────────────────────

  it('?tab=messaging_off shows only members whose messaging is off', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: threeMembers() });
    await renderAt('/broker/monitoring?tab=messaging_off');

    await waitFor(() => {
      expect(screen.getByText('User Two')).toBeInTheDocument();
    });
    expect(screen.queryByText('User One')).toBeNull();
    expect(screen.queryByText('User Three')).toBeNull();
  });

  it('?tab=expiring_soon shows only members whose monitoring lapses within 7 days', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: threeMembers() });
    await renderAt('/broker/monitoring?tab=expiring_soon');

    await waitFor(() => {
      expect(screen.getByText('User Three')).toBeInTheDocument();
    });
    expect(screen.queryByText('User One')).toBeNull();
    expect(screen.getAllByTestId('data-table-row')).toHaveLength(1);
  });

  it('the search box filters the loaded rows by name or reason', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: threeMembers() });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await screen.findByText('User One');
    fireEvent.change(screen.getByLabelText('Search monitored members'), { target: { value: 'spam' } });

    await waitFor(() => {
      expect(screen.getAllByTestId('data-table-row')).toHaveLength(1);
    });
    expect(screen.getByText('User Two')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search monitored members'), { target: { value: 'nobody-matches' } });
    await waitFor(() => {
      expect(screen.getByText('No members match')).toBeInTheDocument();
    });
  });

  // ─── Row actions ───────────────────────────────────────────────────────────

  it('Extend asks first, then re-calls setMonitoring with a new 30-day expiry and the same reason', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [makeMonitoredUser({ user_id: 42, messaging_disabled: true })],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await screen.findByText('Bob Suspect');
    fireEvent.click(screen.getByRole('button', { name: 'Extend monitoring' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Extend monitoring' }));
      expect(mockBroker.setMonitoring).toHaveBeenCalledWith(42, {
        under_monitoring: true,
        reason: 'Suspicious activity',
        messaging_disabled: true,
        expires_days: 30,
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Monitoring extended.');
  });

  it('Extend does nothing when the broker declines', async () => {
    mockConfirm.mockResolvedValue(false);
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: [makeMonitoredUser({ user_id: 42 })] });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await screen.findByText('Bob Suspect');
    fireEvent.click(screen.getByRole('button', { name: 'Extend monitoring' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockBroker.setMonitoring).not.toHaveBeenCalled();
  });

  it('the Refresh button reloads the list', async () => {
    mockBroker.getMonitoring.mockResolvedValue({ success: true, data: [makeMonitoredUser()] });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await screen.findByText('Bob Suspect');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockBroker.getMonitoring).toHaveBeenCalledTimes(2);
    });
  });

  it('renders expiry countdown chips: expired, days-left, and no expiry', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [
        makeMonitoredUser({
          user_id: 1,
          user_name: 'Expired Eddie',
          monitoring_expires_at: new Date(Date.now() - DAY_MS).toISOString(),
        }),
        makeMonitoredUser({
          user_id: 2,
          user_name: 'Soon Sally',
          monitoring_expires_at: new Date(Date.now() + 3 * DAY_MS).toISOString(),
        }),
        makeMonitoredUser({
          user_id: 3,
          user_name: 'Open Olive',
          monitoring_expires_at: null,
        }),
      ],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByText('3 days left')).toBeInTheDocument();
      expect(screen.getByText('No expiry')).toBeInTheDocument();
    });
  });

  it('renders Add User button', async () => {
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => screen.getByText('Nobody is under monitoring'));

    // monitoring.add_button resolves to "Add User"
    const addBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Add User')
    );
    expect(addBtn).toBeDefined();
  });

  it('opens the add-monitoring modal when button is clicked', async () => {
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => screen.getByText('Nobody is under monitoring'));

    const addBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Add User')
    );
    if (addBtn) fireEvent.click(addBtn);

    await waitFor(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('confirm button is disabled until a member is picked, then adds them', async () => {
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => screen.getByText('Nobody is under monitoring'));

    const addBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Add User')
    );
    if (addBtn) fireEvent.click(addBtn);

    const dialog = await screen.findByRole('dialog');
    const modalConfirm = within(dialog).getByRole('button', { name: 'Add User' });
    // HeroUI renders isDisabled as data-disabled attribute
    const isDisabled = () =>
      modalConfirm.hasAttribute('disabled') ||
      modalConfirm.getAttribute('data-disabled') === 'true' ||
      modalConfirm.getAttribute('aria-disabled') === 'true';
    expect(isDisabled()).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'pick member 7' }));
    await waitFor(() => expect(isDisabled()).toBe(false));

    fireEvent.change(within(dialog).getByPlaceholderText('Why is this user being monitored?'), {
      target: { value: 'Follow-up on a report' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add User' }));

    await waitFor(() => {
      expect(mockBroker.setMonitoring).toHaveBeenCalledWith(7, expect.objectContaining({
        under_monitoring: true,
        reason: 'Follow-up on a report',
      }));
    });
  });

  it('opens the edit modal prefilled from the row action', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [
        makeMonitoredUser({
          user_id: 42,
          monitoring_expires_at: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        }),
      ],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => screen.getByText('Bob Suspect'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit monitoring' }));

    await waitFor(() => {
      expect(screen.getByText('Edit Monitoring')).toBeInTheDocument();
      // The record's existing expiry is surfaced so a reason-only edit
      // visibly preserves it
      expect(screen.getByText(/Current expiry:/)).toBeInTheDocument();
    });
  });

  it('calls setMonitoring remove when the row action is confirmed', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [makeMonitoredUser({ user_id: 42 })],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => screen.getByText('Bob Suspect'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove from monitoring' }));

    // ConfirmModal stub renders a Confirm button
    const confirmDialog = await screen.findByRole('dialog', { name: 'Remove from Monitoring' });
    expect(confirmDialog).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(mockBroker.setMonitoring).toHaveBeenCalledWith(42, { under_monitoring: false });
    });
  });

  it('renders multiple monitored users', async () => {
    mockBroker.getMonitoring.mockResolvedValue({
      success: true,
      data: [
        makeMonitoredUser({ user_id: 1, user_name: 'User One' }),
        makeMonitoredUser({ user_id: 2, user_name: 'User Two' }),
      ],
    });
    const { UserMonitoring } = await import('./UserMonitoringPage');
    render(<UserMonitoring />);

    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
      expect(screen.getByText('User Two')).toBeInTheDocument();
    });
  });
});
