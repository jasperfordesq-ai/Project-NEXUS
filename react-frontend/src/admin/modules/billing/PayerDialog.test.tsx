// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { createContext, useContext } from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── UI mock ──────────────────────────────────────────────────────────────────
// Wires a Radio to its group, as in BillingAutomationCard.test.tsx.
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
    Radio: ({ value, children, description, isDisabled }: { value: string; children?: React.ReactNode; description?: React.ReactNode; isDisabled?: boolean }) => {
      const group = useContext(RadioContext);
      return (
        <div>
          <label>
            <input type="radio" disabled={isDisabled} checked={group.value === value} onChange={() => group.onValueChange(value)} />
            {children}
          </label>
          {description ? <span>{description}</span> : null}
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

const PAYER_URL = '/v2/admin/super/billing/standing/payer';
const button = (label: string) => screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

const onClose = vi.fn();
const onSaved = vi.fn();

type Community = {
  id: number;
  name: string;
  payer: 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';
  payerIsDefault: boolean;
  canPayParent: boolean;
};

const renderDialog = async (overrides: Partial<Community> = {}) => {
  const { PayerDialog } = await import('./PayerDialog');
  render(
    <PayerDialog
      community={{ id: 5, name: 'Cork Timebank', payer: 'platform_invoice', payerIsDefault: true, canPayParent: false, ...overrides }}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
};

describe('PayerDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.post.mockResolvedValue({ success: true, data: { standing: {} } });
  });

  it('offers the four ways and the default, each with a line of help', async () => {
    await renderDialog();

    expect(screen.getByLabelText('Platform, by card')).toBeInTheDocument();
    expect(screen.getByLabelText('Platform, by invoice')).toBeInTheDocument();
    expect(screen.getByLabelText('Its parent community')).toBeInTheDocument();
    expect(screen.getByLabelText('Not billed')).toBeInTheDocument();
    expect(screen.getByLabelText('The usual way (recommended)')).toBeInTheDocument();
    expect(screen.getByText((text) => text.startsWith('Pays the platform by invoice or bank transfer.'))).toBeInTheDocument();
  });

  it('opens on the default when nothing has been chosen, and on the stored choice otherwise', async () => {
    await renderDialog();
    expect(screen.getByLabelText('The usual way (recommended)')).toBeChecked();
  });

  it('opens on a stored choice', async () => {
    await renderDialog({ payer: 'not_billed', payerIsDefault: false });
    expect(screen.getByLabelText('Not billed')).toBeChecked();
  });

  it('sends the chosen way to pay', async () => {
    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getByLabelText('Platform, by invoice'));
    await user.click(button('Save')!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(PAYER_URL, { tenant_id: 5, payer: 'platform_invoice' }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Saved how this community pays'));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('sends null to go back to the default', async () => {
    const user = userEvent.setup();
    await renderDialog({ payer: 'not_billed', payerIsDefault: false });

    await user.click(screen.getByLabelText('The usual way (recommended)'));
    await user.click(button('Save')!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(PAYER_URL, { tenant_id: 5, payer: null }));
  });

  it('does not offer "its parent" to a community with no parent below the platform, and says why', async () => {
    await renderDialog({ canPayParent: false });
    expect(screen.getByLabelText('Its parent community')).toBeDisabled();
    expect(screen.getByText(
      'Not available. This community sits directly under the platform, so it has no parent community to pay.',
    )).toBeInTheDocument();
    // The reason stands in place of what the choice would do.
    expect(screen.queryByText('Pays its parent community, not the platform.')).not.toBeInTheDocument();
  });

  it('says what the choice does when "its parent" can be chosen', async () => {
    await renderDialog({ canPayParent: true });
    expect(screen.getByLabelText('Its parent community')).not.toBeDisabled();
    expect(screen.getByText('Pays its parent community, not the platform.')).toBeInTheDocument();
    expect(screen.queryByText(/^Not available\./)).not.toBeInTheDocument();
  });

  // ── The box explains itself (23 Nov 2026) ────────────────────────────────

  it('puts the usual way first', async () => {
    await renderDialog();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios[0]).toBe(screen.getByLabelText('The usual way (recommended)'));
    expect(radios[1]).toBe(screen.getByLabelText('Platform, by card'));
    expect(radios[4]).toBe(screen.getByLabelText('Not billed'));
  });

  it('says what the usual way comes to for this community while it is in force', async () => {
    await renderDialog({ payer: 'platform_invoice', payerIsDefault: true });

    expect(screen.getByText((text) => text.endsWith('For this community that is now: Platform, by invoice.'))).toBeInTheDocument();
  });

  it('does not guess what the usual way would come to while another choice is stored', async () => {
    await renderDialog({ payer: 'not_billed', payerIsDefault: false });

    expect(screen.queryByText((text) => text.includes('For this community that is now'))).not.toBeInTheDocument();
  });

  it('says that choosing "by card" does not set a card up, and that a change restarts the warnings', async () => {
    await renderDialog();

    expect(screen.getByText((text) => text.includes("Choosing this does not set up a card: the community's own admin does that from its Billing page."))).toBeInTheDocument();
    expect(screen.getByText('Changing this starts the payment warnings again, so the community is never paused without a fresh warning.')).toBeInTheDocument();
  });

  it('shows the server’s own refusal', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'Only a community with a parent community can pay its parent.', code: 'PAYER_NEEDS_PARENT' });
    await renderDialog({ canPayParent: true });

    await user.click(screen.getByLabelText('Its parent community'));
    await user.click(button('Save')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Only a community with a parent community can pay its parent.'));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
