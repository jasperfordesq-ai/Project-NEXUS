// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── Mock adminVolunteering API ───────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getReminderSettings: vi.fn(),
    updateReminderSettings: vi.fn(),
    getReminderLogs: vi.fn(),
    sendShiftReminders: vi.fn(),
    getWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    testWebhook: vi.fn(),
    getWebhookLogs: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub DataTable / PageHeader / EmptyState / ConfirmModal ─────────────────
// The component imports these from their '../../components/<Name>' subpaths, so
// each subpath module must be mocked individually — mocking the '../../components'
// index barrel does NOT intercept subpath imports.
vi.mock('../../components/DataTable', () => ({
  DataTable: ({
    data,
    columns,
    emptyContent,
    isLoading,
  }: {
    data?: unknown[];
    columns?: Array<{ key: string; label?: string; render?: (row: unknown) => React.ReactNode }>;
    emptyContent?: React.ReactNode;
    isLoading?: boolean;
  }) => {
    if (isLoading) return <div role="status" aria-busy="true">Loading...</div>;
    if (!data || data.length === 0) return <>{emptyContent}</>;
    return (
      <table>
        <tbody>
          {(data as Record<string, unknown>[]).map((row) => (
            <tr key={String(row['id'])}>
              {(columns ?? []).map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : String(row[col.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({
    isOpen,
    onConfirm,
    onClose,
    title,
  }: {
    isOpen?: boolean;
    onConfirm?: () => void;
    onClose?: () => void;
    title?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

// Stub HeroUI Select/Switch to avoid infinite-loops
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: { label?: string; children?: React.ReactNode; onSelectionChange?: (keys: Set<string>) => void }) => (
      <select aria-label={label ?? 'select'} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id ?? ''}>{children}</option>
    ),
    Switch: ({ children, isSelected, onValueChange }: { children?: React.ReactNode; isSelected?: boolean; onValueChange?: (v: boolean) => void }) => (
      <input
        type="checkbox"
        aria-label={typeof children === 'string' ? children : 'switch'}
        checked={!!isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
  };
});

// ─── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin', is_super_admin: true, role: 'super_admin' },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
    }),
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeReminderResponse = () => ([
  {
    reminder_type: 'pre_shift',
    enabled: true,
    hours_before: 24,
    hours_after: null,
    days_inactive: null,
    days_before_expiry: null,
    email_enabled: true,
    push_enabled: true,
    sms_enabled: false,
  },
]);

const makeWebhook = () => ({
  id: 10,
  name: 'My Webhook',
  url: 'https://example.com/hook',
  events: ['shift.completed'],
  is_active: true,
  failure_count: 0,
  created_at: '2025-01-01T00:00:00Z',
});

async function renderPage() {
  const { default: VolunteerConfig } = await import('./VolunteerConfig');
  render(<VolunteerConfig />);
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
}

async function openWebhooksTab(user: ReturnType<typeof userEvent.setup>) {
  const tab = screen.getAllByRole('tab').find((t) => /webhook/i.test(t.textContent ?? ''));
  expect(tab).toBeDefined();
  await user.click(tab!);
  await waitFor(() => expect(screen.getByText('My Webhook')).toBeInTheDocument());
}

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getReminderSettings.mockResolvedValue({ success: true, data: makeReminderResponse() });
    mockAdminVolunteering.getReminderLogs.mockResolvedValue({ success: true, data: [] });
    mockAdminVolunteering.getWebhooks.mockResolvedValue({ success: true, data: [makeWebhook()] });
    mockAdminVolunteering.updateReminderSettings.mockResolvedValue({ success: true });
    mockAdminVolunteering.sendShiftReminders.mockResolvedValue({ success: true, data: { reminders_sent: 3 } });
    mockAdminVolunteering.createWebhook.mockResolvedValue({ success: true });
    mockAdminVolunteering.deleteWebhook.mockResolvedValue({ success: true });
    mockAdminVolunteering.testWebhook.mockResolvedValue({ success: true, data: { success: true, http_code: 200, response: 'ok' } });
    mockAdminVolunteering.getWebhookLogs.mockResolvedValue({ success: true, data: [] });
  });

  it('has only the Reminders and Webhooks tabs (Custom Fields was removed)', async () => {
    await renderPage();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs.some((t) => /custom/i.test(t.textContent ?? ''))).toBe(false);
  });

  it('opens on Reminders and loads the reminder settings', async () => {
    await renderPage();

    await waitFor(() => expect(mockAdminVolunteering.getReminderSettings).toHaveBeenCalledTimes(1));
  });

  it('offers only the email channel — there is no SMS or push sender', async () => {
    await renderPage();

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /email/i })).toBeInTheDocument());
    expect(screen.queryByRole('checkbox', { name: /sms/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /push/i })).not.toBeInTheDocument();
  });

  it('saves reminders without SMS or push settings and confirms', async () => {
    const user = userEvent.setup();
    await renderPage();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /email/i })).toBeInTheDocument());

    const saveBtn = screen.getAllByRole('button').find((b) => /save/i.test(b.textContent ?? ''));
    expect(saveBtn).toBeDefined();
    await user.click(saveBtn!);

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    const sent = mockAdminVolunteering.updateReminderSettings.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ reminder_type: 'pre_shift', email_enabled: true, hours_before: 24 });
    expect(sent).not.toHaveProperty('sms_enabled');
    expect(sent).not.toHaveProperty('push_enabled');
  });

  it('reports a webhook test as failed when the receiving system rejects it', async () => {
    mockAdminVolunteering.testWebhook.mockResolvedValueOnce({
      success: true,
      data: { success: false, http_code: 500, response: 'boom' },
    });
    const user = userEvent.setup();
    await renderPage();
    await openWebhooksTab(user);

    await user.click(screen.getByRole('button', { name: /test webhook/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('reports a webhook test as sent when the receiving system accepts it', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openWebhooksTab(user);

    await user.click(screen.getByRole('button', { name: /test webhook/i }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('shows the event name and response code in the webhook log', async () => {
    mockAdminVolunteering.getWebhookLogs.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 1,
        webhook_id: 10,
        event_type: 'shift.completed',
        response_code: 503,
        response_body: 'unavailable',
        status: 'failed',
        created_at: '2026-10-17T10:00:00Z',
      }],
    });
    const user = userEvent.setup();
    await renderPage();
    await openWebhooksTab(user);

    await user.click(screen.getByRole('button', { name: /view logs/i }));

    await waitFor(() => expect(screen.getAllByText('shift.completed').length).toBeGreaterThan(1));
    expect(screen.getByText('503')).toBeInTheDocument();
  });
});
