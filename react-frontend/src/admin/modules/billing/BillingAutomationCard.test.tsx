// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { createContext, useContext } from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import { formatDate } from '@/lib/helpers';

// ─── UI mock ──────────────────────────────────────────────────────────────────
// The shared uiMock renders a Radio as an input with no handler of its own, so
// a choice made on it never reaches the RadioGroup. These two overrides wire a
// Radio to its group; everything else is the shared mock.
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;
  const RadioContext = createContext<{ value: string; onValueChange: (v: string) => void }>({ value: '', onValueChange: () => {} });

  const overrides: Record<string, unknown> = {
    RadioGroup: ({ value, onValueChange, children, label }: { value: string; onValueChange: (v: string) => void; children?: React.ReactNode; label?: React.ReactNode }) => (
      <fieldset>
        {label ? <legend>{label}</legend> : null}
        <RadioContext.Provider value={{ value, onValueChange }}>{children}</RadioContext.Provider>
      </fieldset>
    ),
    Radio: ({ value, children, description }: { value: string; children?: React.ReactNode; description?: React.ReactNode }) => {
      const group = useContext(RadioContext);
      return (
        <div>
          <label>
            <input type="radio" checked={group.value === value} onChange={() => group.onValueChange(value)} />
            {children}
          </label>
          {description ? <p>{description}</p> : null}
        </div>
      );
    },
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return true;
      return Reflect.has(target, prop);
    },
  });
});

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
}));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

// ─── Fixtures: the server's shape ─────────────────────────────────────────────
// GET /v2/admin/super/billing/settings is BillingSettings::all(); the preview is
// BillingAutomationService::preview(). Both are pinned by
// tests/Laravel/Feature/Billing/BillingAutomationEndpointsTest.php.
const makeSettings = (overrides: Record<string, unknown> = {}) => ({
  automation_enabled: false,
  reminder_days: '30,14,7,1',
  final_warning_days_late: 7,
  suspend_days_late: 14,
  card_retry_max_days_late: 30,
  limit_warning_percent: 80,
  over_limit_action: 'none',
  over_limit_grace_days: 30,
  ...overrides,
});

const paymentPause = {
  tenant_id: 5,
  tenant_name: 'Cork Timebank',
  clock: 'payment',
  action: 'suspend',
  detail: { paid_until: '2026-10-01', days_late: 20, pause_date: '2026-10-15' },
};

const limitWarning = {
  tenant_id: 6,
  tenant_name: 'Galway Timebank',
  clock: 'member_limit',
  action: 'approaching',
  detail: { active_members: 85, max_users: 100, percent: 85, plan_name: 'Spark', window_days: 90, stage: 'approaching' },
};

const serve = (settings: unknown, preview: unknown[]) => {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/admin/super/billing/settings') return Promise.resolve({ success: true, data: settings });
    if (url === '/v2/admin/super/billing/standing/preview') return Promise.resolve({ success: true, data: preview });
    return Promise.resolve({ success: false, error: 'unexpected' });
  });
};

const button = (label: string) => screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

const renderCard = async () => {
  const { BillingAutomationCard } = await import('./BillingAutomationCard');
  render(<BillingAutomationCard />);
  await waitFor(() => expect(screen.getByLabelText('Run the automatic checks every morning')).toBeInTheDocument());
};

describe('BillingAutomationCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serve(makeSettings(), [paymentPause, limitWarning]);
    mockApi.put.mockImplementation((_url: string, body: Record<string, unknown>) =>
      Promise.resolve({ success: true, data: makeSettings(body) }));
  });

  it('says the checks are off, and that nothing is sent and nobody is paused', async () => {
    await renderCard();

    expect(screen.getByLabelText('Run the automatic checks every morning')).not.toBeChecked();
    expect(screen.getByText((text) => text.startsWith('Switched off. Nothing is sent and no community is paused.'))).toBeInTheDocument();
  });

  it('lists what would happen today, while the switch is off', async () => {
    await renderCard();

    await waitFor(() => expect(screen.getByText('Cork Timebank')).toBeInTheDocument());
    expect(screen.getByText('Paused for non-payment: 20 days late')).toBeInTheDocument();
    expect(screen.getByText('Galway Timebank')).toBeInTheDocument();
    expect(screen.getByText('Warning: 85 of 100 active members (85%)')).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('Member limit')).toBeInTheDocument();
  });

  it('names a card payer that is late but not paused because Stripe is still retrying, and the latest pause date', async () => {
    serve(makeSettings(), [{
      tenant_id: 7,
      tenant_name: 'Sligo Timebank',
      clock: 'payment',
      action: 'waiting_for_stripe',
      detail: { paid_until: '2026-10-01', days_late: 20, pause_date: '2026-10-31' },
    }]);
    await renderCard();

    await waitFor(() => expect(screen.getByText('Sligo Timebank')).toBeInTheDocument());
    expect(screen.getByText(
      `Not paused yet: 20 days late and Stripe is still retrying the card. Paused on ${formatDate('2026-10-31')} at the latest`,
    )).toBeInTheDocument();
  });

  it('names a pending move up and the plan it goes to', async () => {
    serve(makeSettings(), [{
      tenant_id: 8, tenant_name: 'Mallow Timebank', clock: 'member_limit', action: 'move_up',
      detail: { active_members: 1043, max_users: 1000, move_plan: 'Growth' },
    }]);
    await renderCard();

    await waitFor(() => expect(screen.getByText('Would be moved up to Growth')).toBeInTheDocument());
    expect(screen.queryByText('Another action')).not.toBeInTheDocument();
  });

  it('says in words why a move needs a decision', async () => {
    serve(makeSettings(), [
      { tenant_id: 8, tenant_name: 'Mallow Timebank', clock: 'member_limit', action: 'needs_decision', detail: { decision_reason: 'no_plan_fits' } },
      { tenant_id: 9, tenant_name: 'Cobh Timebank', clock: 'member_limit', action: 'needs_decision', detail: { decision_reason: 'custom_price' } },
      { tenant_id: 10, tenant_name: 'Youghal Timebank', clock: 'member_limit', action: 'needs_decision', detail: { decision_reason: 'card_subscription' } },
    ]);
    await renderCard();

    await waitFor(() => expect(screen.getByText('Needs a decision: no plan offered to it is big enough')).toBeInTheDocument());
    expect(screen.getByText('Needs a decision: it has a specially agreed price')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision: it pays by card, so the platform team moves it by hand')).toBeInTheDocument();
  });

  it('writes the member figures in the reader’s number format', async () => {
    serve(makeSettings(), [{
      tenant_id: 8, tenant_name: 'Mallow Timebank', clock: 'member_limit', action: 'over',
      detail: { active_members: 1043, max_users: 1000 },
    }]);
    await renderCard();

    await waitFor(() => expect(screen.getByText('Over the limit: 1,043 of 1,000 active members')).toBeInTheDocument());
  });

  it('loads the reminder days and the longest wait for Stripe, and no longer shows the single reminder day', async () => {
    serve(makeSettings({ reminder_days: '45,20', card_retry_max_days_late: 21 }), []);
    await renderCard();

    expect((screen.getByLabelText('Reminders: days before the paid-until date') as HTMLInputElement).value).toBe('45,20');
    expect((screen.getByLabelText('Longest wait for a card Stripe is still retrying: days late') as HTMLInputElement).value).toBe('21');
    expect(screen.getByText('Comma separated, for example 30, 14, 7, 1. Leave it empty to send no reminders.')).toBeInTheDocument();
    expect(screen.getByText('After this many days late the community is paused, whatever Stripe says.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reminder: days before the paid-until date')).not.toBeInTheDocument();
  });

  it('sends the reminder days as typed, and the longest wait as a number', async () => {
    const user = userEvent.setup();
    await renderCard();

    fireEvent.change(screen.getByLabelText('Reminders: days before the paid-until date'), { target: { value: '7, 30,14' } });
    fireEvent.change(screen.getByLabelText('Longest wait for a card Stripe is still retrying: days late'), { target: { value: '45' } });
    await user.click(button('Save settings')!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', {
        reminder_days: '7, 30,14',
        card_retry_max_days_late: 45,
      });
    });
  });

  it('sends an emptied reminder list as an empty string, which means no reminders', async () => {
    const user = userEvent.setup();
    await renderCard();

    fireEvent.change(screen.getByLabelText('Reminders: days before the paid-until date'), { target: { value: '' } });
    await user.click(button('Save settings')!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', { reminder_days: '' });
    });
  });

  it('shows the server’s refusal of a reminder list', async () => {
    const user = userEvent.setup();
    mockApi.put.mockResolvedValue({ success: false, error: 'One of the settings is not valid, so nothing was saved.', code: 'BILLING_SETTING_INVALID' });
    await renderCard();

    fireEvent.change(screen.getByLabelText('Reminders: days before the paid-until date'), { target: { value: '30, soon' } });
    await user.click(button('Save settings')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('One of the settings is not valid, so nothing was saved.'));
    expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', { reminder_days: '30, soon' });
    expect((screen.getByLabelText('Reminders: days before the paid-until date') as HTMLInputElement).value).toBe('30, soon');
  });

  it('says so in words when nothing would happen', async () => {
    serve(makeSettings(), []);
    await renderCard();

    await waitFor(() => expect(screen.getByText('Nothing would happen today.')).toBeInTheDocument());
  });

  it('says so when the list cannot be loaded', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/admin/super/billing/settings') return Promise.resolve({ success: true, data: makeSettings() });
      return Promise.resolve({ success: false, error: 'boom' });
    });
    await renderCard();

    await waitFor(() => expect(screen.getByText('The list of what would happen today could not be loaded.')).toBeInTheDocument());
  });

  it('offers no save until something changes', async () => {
    await renderCard();

    expect(button('Save settings')).toBeDisabled();
  });

  it('sends only what changed, and refreshes the list after saving', async () => {
    const user = userEvent.setup();
    await renderCard();
    await waitFor(() => expect(screen.getByText('Cork Timebank')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Run the automatic checks every morning'));
    fireEvent.change(screen.getByLabelText('Final warning: days late'), { target: { value: '3' } });
    await user.click(button('Save settings')!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', {
        automation_enabled: true,
        final_warning_days_late: 3,
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Settings saved'));
    const previewCalls = mockApi.get.mock.calls.filter(([url]) => url === '/v2/admin/super/billing/standing/preview');
    expect(previewCalls.length).toBe(2);
  });

  const DAYS = 'Days over the limit before pausing or moving up';

  it('offers the four rules for the platform default, each with what it does', async () => {
    await renderCard();

    for (const label of ['Warn only', 'Stop new members joining', 'Pause the community', 'Move up to the next plan']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Nobody new can join/)).toBeInTheDocument();
    expect(screen.getByText(/moved to the smallest plan that fits/)).toBeInTheDocument();
  });

  it('shows the grace days only for a rule that waits', async () => {
    const user = userEvent.setup();
    await renderCard();

    expect(screen.queryByLabelText(DAYS)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Stop new members joining'));
    expect(screen.queryByLabelText(DAYS)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Move up to the next plan'));
    expect(screen.getByLabelText(DAYS)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Pause the community'));
    expect(screen.getByLabelText(DAYS)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(DAYS), { target: { value: '45' } });
    await user.click(button('Save settings')!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', {
        over_limit_action: 'pause',
        over_limit_grace_days: 45,
      });
    });
  });

  it('saves stop new members joining as block_joining', async () => {
    const user = userEvent.setup();
    await renderCard();

    await user.click(screen.getByLabelText('Stop new members joining'));
    await user.click(button('Save settings')!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/billing/settings', { over_limit_action: 'block_joining' });
    });
  });

  it('opens on the saved choice to pause', async () => {
    serve(makeSettings({ over_limit_action: 'pause', over_limit_grace_days: 21 }), []);
    await renderCard();

    expect(screen.getByLabelText('Pause the community')).toBeChecked();
    expect((screen.getByLabelText(DAYS) as HTMLInputElement).value).toBe('21');
  });

  it('opens on the saved choice to move up', async () => {
    serve(makeSettings({ over_limit_action: 'upgrade', over_limit_grace_days: 10 }), []);
    await renderCard();

    expect(screen.getByLabelText('Move up to the next plan')).toBeChecked();
    expect((screen.getByLabelText(DAYS) as HTMLInputElement).value).toBe('10');
  });

  it('shows the server’s own refusal and keeps the change on screen', async () => {
    const user = userEvent.setup();
    mockApi.put.mockResolvedValue({ success: false, error: 'One of the settings is not valid, so nothing was saved.', code: 'BILLING_SETTING_INVALID' });
    await renderCard();

    fireEvent.change(screen.getByLabelText('Pause: days late'), { target: { value: '2' } });
    await user.click(button('Save settings')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('One of the settings is not valid, so nothing was saved.'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Pause: days late') as HTMLInputElement).value).toBe('2');
  });

  it('says so when the settings cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'nope' });
    const { BillingAutomationCard } = await import('./BillingAutomationCard');
    render(<BillingAutomationCard />);

    await waitFor(() => expect(screen.getByText('The settings could not be loaded.')).toBeInTheDocument());
    expect(button('Save settings')).toBeUndefined();
  });
});
