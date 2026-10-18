// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── API mocks ────────────────────────────────────────────────────────────────
const { mockIntegrations, mockSuper } = vi.hoisted(() => ({
  mockIntegrations: {
    getWebhookEvents: vi.fn(),
    getWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    testWebhook: vi.fn(),
    rotateWebhookSecret: vi.fn(),
    getWebhookDeliveries: vi.fn(),
  },
  mockSuper: { listTenants: vi.fn() },
}));

vi.mock('../../api/adminApi', () => ({
  adminIntegrations: mockIntegrations,
  adminSuper: mockSuper,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// The component imports these from their subpaths, so each must be mocked.
vi.mock('../../components/DataTable', () => ({
  DataTable: ({ data, columns, isLoading }: {
    data?: unknown[];
    columns?: Array<{ key: string; render?: (row: unknown) => React.ReactNode }>;
    isLoading?: boolean;
  }) => {
    if (isLoading) return <div role="status" aria-busy="true">Loading...</div>;
    return (
      <table>
        <tbody>
          {((data ?? []) as Record<string, unknown>[]).map((row) => (
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
  PageHeader: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => <div><h1>{title}</h1>{actions}</div>,
}));
vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title, confirmLabel }: {
    isOpen?: boolean; onConfirm?: () => void; onClose?: () => void; title?: string; confirmLabel?: string;
  }) => isOpen ? (
    <div role="dialog" aria-label={title}>
      <span>{title}</span>
      <button onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  ) : null,
}));

// HeroUI Select/Switch stubs (jsdom loops); the checkbox group is the real one.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: { label?: string; children?: React.ReactNode; onSelectionChange?: (keys: Set<string>) => void }) => (
      <select aria-label={label ?? 'select'} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
        <option value="">—</option>
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => <option value={id ?? ''}>{children}</option>,
    Switch: ({ children, isSelected, onValueChange }: { children?: React.ReactNode; isSelected?: boolean; onValueChange?: (v: boolean) => void }) => (
      <input type="checkbox" aria-label={typeof children === 'string' ? children : 'switch'} checked={!!isSelected} onChange={(e) => onValueChange?.(e.target.checked)} />
    ),
  };
});

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Hour Timebank', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
  })
);
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

const EVENTS = [
  'shift.completed',
  'job.vacancy.created',
  'job.application.created',
  'job.application.status_changed',
  'job.application.bulk_status_changed',
  'job.offer.accepted',
];

const makeWebhook = () => ({
  id: 10,
  name: 'CRM',
  url: 'https://example.com/hook',
  events: ['shift.completed'],
  is_active: true,
  failure_count: 0,
  last_triggered_at: null,
  created_at: '2026-10-01T00:00:00Z',
});

async function renderPage() {
  const { default: OutboundWebhooks } = await import('./OutboundWebhooks');
  render(<OutboundWebhooks />);
  await waitFor(() => expect(screen.getByText('CRM')).toBeInTheDocument());
}

describe('OutboundWebhooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIntegrations.getWebhookEvents.mockResolvedValue({ success: true, data: EVENTS });
    mockIntegrations.getWebhooks.mockResolvedValue({ success: true, data: [makeWebhook()] });
    mockIntegrations.createWebhook.mockResolvedValue({ success: true, data: { id: 11, secret: 'shh-6f1e9c2a-once-only' } });
    mockIntegrations.updateWebhook.mockResolvedValue({ success: true, data: { success: true } });
    mockIntegrations.deleteWebhook.mockResolvedValue({ success: true, data: { success: true } });
    mockIntegrations.testWebhook.mockResolvedValue({ success: true, data: { success: true, http_code: 200, response: 'ok' } });
    mockIntegrations.rotateWebhookSecret.mockResolvedValue({ success: true, data: { id: 10, secret: 'new-5d2b-secret' } });
    mockIntegrations.getWebhookDeliveries.mockResolvedValue({ success: true, data: [] });
    mockSuper.listTenants.mockResolvedValue({ success: true, data: [{ id: 2, name: 'Hour Timebank' }, { id: 7, name: 'Minehead & Coast' }] });
  });

  it('loads the current community\'s webhooks and names the events in plain English', async () => {
    await renderPage();

    expect(mockIntegrations.getWebhooks).toHaveBeenCalledWith(2);
    expect(screen.getByText('A volunteer completes a shift')).toBeInTheDocument();
  });

  it('offers the six real events as a checklist, not a free-text box', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /add webhook/i }));

    for (const label of [
      'A volunteer completes a shift',
      'A job vacancy is posted',
      'Someone applies for a job',
      "A job application's status changes",
      'Several job applications change status at once',
      'A job offer is accepted',
    ]) {
      expect(await screen.findByRole('checkbox', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeInTheDocument();
    }
    expect(screen.queryByRole('textbox', { name: /events/i })).not.toBeInTheDocument();
  });

  it('shows the signing secret once after creating a webhook', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /add webhook/i }));
    await user.type(await screen.findByRole('textbox', { name: /^name/i }), 'Payroll');
    await user.type(screen.getByRole('textbox', { name: /address/i }), 'https://payroll.example.com/hook');
    await user.click(screen.getByRole('checkbox', { name: /a job offer is accepted/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockIntegrations.createWebhook).toHaveBeenCalledTimes(1));
    const [payload, tenantId] = mockIntegrations.createWebhook.mock.calls[0] as [Record<string, unknown>, number];
    expect(payload).toMatchObject({ name: 'Payroll', url: 'https://payroll.example.com/hook', events: ['job.offer.accepted'], is_active: true });
    expect(tenantId).toBe(2);
    expect(await screen.findByText('shh-6f1e9c2a-once-only')).toBeInTheDocument();
    expect(screen.getByText(/shown only this once/i)).toBeInTheDocument();
  });

  it('manages the chosen community\'s webhooks', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(screen.getByRole('combobox', { name: /community/i }), '7');

    await waitFor(() => expect(mockIntegrations.getWebhooks).toHaveBeenLastCalledWith(7));
  });

  it('reports a test as failed when the receiving system rejects it', async () => {
    mockIntegrations.testWebhook.mockResolvedValueOnce({ success: true, data: { success: false, http_code: 500, response: 'boom' } });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('reports a test as accepted when the receiving system takes it', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('generates a new secret after confirming and shows it once', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /generate a new secret/i }));
    await user.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(mockIntegrations.rotateWebhookSecret).toHaveBeenCalledWith(10, 2));
    expect(await screen.findByText('new-5d2b-secret')).toBeInTheDocument();
  });

  it('shows the event and response code of each delivery', async () => {
    mockIntegrations.getWebhookDeliveries.mockResolvedValueOnce({
      success: true,
      data: [{ id: 1, webhook_id: 10, event_type: 'shift.completed', response_code: 503, response_body: 'unavailable', status: 'failed', created_at: '2026-10-17T10:00:00Z' }],
    });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /view deliveries/i }));

    await waitFor(() => expect(screen.getByText('503')).toBeInTheDocument());
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });
});
