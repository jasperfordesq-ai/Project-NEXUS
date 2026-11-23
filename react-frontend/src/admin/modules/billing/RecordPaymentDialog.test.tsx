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
// The shared uiMock renders a Radio with no handler of its own; these overrides
// wire a Radio to its group, as in BillingAutomationCard.test.tsx.
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
    Radio: ({ value, children, isDisabled }: { value: string; children?: React.ReactNode; isDisabled?: boolean }) => {
      const group = useContext(RadioContext);
      return (
        <label>
          <input type="radio" disabled={isDisabled} checked={group.value === value} onChange={() => group.onValueChange(value)} />
          {children}
        </label>
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

// ─── Fixtures: BillingStandingService::payments(), the server's shape ────────
const makePayment = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  received_on: '2026-11-02',
  method: 'bank_transfer',
  reference: 'INV-2026-114',
  amount: '480.00',
  currency: 'EUR',
  paid_until_before: '2026-10-31',
  paid_until_after: '2027-10-31',
  recorded_by_user_id: 1,
  recorded_by_name: 'Pat Murphy',
  created_at: '2026-11-02 10:15:00',
  source: 'manual',
  payee_tenant_id: null,
  payee_name: null,
  recorded_by_platform_team: true,
  voided_at: null,
  voided_by_name: null,
  voided_by_platform_team: false,
  void_reason: null,
  can_void: true,
  refunded_amount: null,
  refunded_at: null,
  dispute_state: null,
  disputed_at: null,
  ...overrides,
});

const PAYMENTS_URL = '/v2/admin/super/billing/standing/payments?tenant_id=5';
const RECORD_URL = '/v2/admin/super/billing/standing/record-payment';
const VOID_URL = '/v2/admin/super/billing/standing/void-payment';

const servePayments = (rows: unknown) => {
  mockApi.get.mockImplementation((url: string) => {
    if (url === PAYMENTS_URL) return Promise.resolve({ success: true, data: rows });
    return Promise.resolve({ success: false, error: 'unexpected' });
  });
};

const button = (label: string) => screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

const today = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const onClose = vi.fn();
const onRecorded = vi.fn();
const onVoided = vi.fn();

const renderDialog = async (paidUntil: string | null = '2026-12-31') => {
  const { RecordPaymentDialog } = await import('./RecordPaymentDialog');
  render(
    <RecordPaymentDialog
      community={{ id: 5, name: 'Cork Timebank', paidUntil }}
      onClose={onClose}
      onRecorded={onRecorded}
      onVoided={onVoided}
    />,
  );
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(PAYMENTS_URL));
};

describe('RecordPaymentDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    servePayments([]);
    mockApi.post.mockResolvedValue({ success: true, data: { standing: {}, payment_id: 9 } });
  });

  it('renders nothing when no community is chosen', async () => {
    const { RecordPaymentDialog } = await import('./RecordPaymentDialog');
    render(<RecordPaymentDialog community={null} onClose={onClose} onRecorded={onRecorded} />);

    expect(screen.queryByLabelText('Received on')).not.toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  // The new date is typed, never prefilled: a prefilled current date was
  // sent back unchanged, which recorded a payment that changed nothing.
  it('opens on today and bank transfer, with the new paid-until date empty and the current one shown', async () => {
    await renderDialog();

    expect((screen.getByLabelText('Received on') as HTMLInputElement).value).toBe(today());
    expect((screen.getByLabelText('Now paid up to and including') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(`Currently paid until ${formatDate('2026-12-31')}. The new date must be later.`)).toBeInTheDocument();
    expect(button('Record payment')).toBeDisabled();
    expect(screen.getByLabelText('Bank transfer')).toBeChecked();
    expect(screen.getByLabelText('Cheque')).toBeInTheDocument();
    expect(screen.getByLabelText('Cash')).toBeInTheDocument();
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
    // Not "Card": Stripe reports a card payment by itself, and one typed in
    // here would be counted twice.
    expect(screen.queryByLabelText('Card')).not.toBeInTheDocument();
  });

  // ── The dialog does the arithmetic (23 Nov 2026) ─────────────────────────

  it('works out one month and one year on, keeping to the end of a short month', async () => {
    const { laterDate } = await import('./RecordPaymentDialog');

    expect(laterDate('2026-12-31', 'month')).toBe('2027-01-31');
    expect(laterDate('2027-01-31', 'month')).toBe('2027-02-28');
    expect(laterDate('2026-12-31', 'year')).toBe('2027-12-31');
    // 29 February, a year on, in a year that has none.
    expect(laterDate('2028-02-29', 'year')).toBe('2029-02-28');
    expect(laterDate('not a date', 'month')).toBe('');
  });

  it('offers the date one month and one year on, and one press fills it in', async () => {
    await renderDialog();

    fireEvent.click(button(`Add one year: ${formatDate('2027-12-31')}`)!);

    expect((screen.getByLabelText('Now paid up to and including') as HTMLInputElement).value).toBe('2027-12-31');
    expect(button('Record payment')).not.toBeDisabled();
    expect(button(`Add one month: ${formatDate('2027-01-31')}`)).toBeDefined();
  });

  it('counts on from the day the payment was received when there is no date yet', async () => {
    await renderDialog(null);

    const received = (screen.getByLabelText('Received on') as HTMLInputElement).value;
    const { laterDate } = await import('./RecordPaymentDialog');
    fireEvent.click(button(`Add one month: ${formatDate(laterDate(received, 'month'))}`)!);

    expect((screen.getByLabelText('Now paid up to and including') as HTMLInputElement).value).toBe(laterDate(received, 'month'));
  });

  it('fills in the amount and currency from the plan with the date, and says where they came from', async () => {
    const { RecordPaymentDialog } = await import('./RecordPaymentDialog');
    render(
      <RecordPaymentDialog
        community={{ id: 5, name: 'Cork Timebank', paidUntil: '2026-12-31', plan: { monthly: 49, yearly: 490, currency: 'eur' } }}
        onClose={onClose}
        onRecorded={onRecorded}
      />,
    );
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(PAYMENTS_URL));

    // The community's own currency is chosen before anything is typed.
    expect(screen.getByLabelText('EUR')).toBeChecked();
    expect((screen.getByLabelText('Amount (optional)') as HTMLInputElement).value).toBe('');

    fireEvent.click(button(`Add one year: ${formatDate('2027-12-31')}`)!);
    expect((screen.getByLabelText('Amount (optional)') as HTMLInputElement).value).toBe('490');
    expect(screen.getByText("Filled in from the plan's price. Change it if a different amount was paid.")).toBeInTheDocument();

    // The other period swaps the offered amount; an amount the person typed is theirs.
    fireEvent.click(button(`Add one month: ${formatDate('2027-01-31')}`)!);
    expect((screen.getByLabelText('Amount (optional)') as HTMLInputElement).value).toBe('49');

    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '120' } });
    fireEvent.click(button(`Add one year: ${formatDate('2027-12-31')}`)!);
    expect((screen.getByLabelText('Amount (optional)') as HTMLInputElement).value).toBe('120');
    expect(screen.queryByText("Filled in from the plan's price. Change it if a different amount was paid.")).not.toBeInTheDocument();
  });

  it('shows the payment history alone, with no form, when opened for the history', async () => {
    const { RecordPaymentDialog } = await import('./RecordPaymentDialog');
    render(
      <RecordPaymentDialog
        mode="history"
        community={{ id: 5, name: 'Cork Timebank', paidUntil: '2026-12-31' }}
        onClose={onClose}
        onRecorded={onRecorded}
      />,
    );
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(PAYMENTS_URL));

    expect(screen.queryByLabelText('Received on')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Now paid up to and including')).not.toBeInTheDocument();
    expect(button('Record payment')).toBeUndefined();
    expect(button('Close')).toBeDefined();
    expect(await screen.findByText('No payments have been recorded yet.')).toBeInTheDocument();
  });

  it('cannot be sent without a paid-until date', async () => {
    await renderDialog(null);

    expect((screen.getByLabelText('Now paid up to and including') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/Currently paid until/)).not.toBeInTheDocument();
    expect(button('Record payment')).toBeDisabled();
  });

  it('cannot be sent with a paid-until date that is not later than the current one', async () => {
    await renderDialog();
    const field = screen.getByLabelText('Now paid up to and including');

    fireEvent.change(field, { target: { value: '2026-12-31' } });
    expect(button('Record payment')).toBeDisabled();
    fireEvent.change(field, { target: { value: '2026-11-30' } });
    expect(button('Record payment')).toBeDisabled();
    fireEvent.change(field, { target: { value: '2027-01-31' } });
    expect(button('Record payment')).not.toBeDisabled();
  });

  it('will not send an amount that is not a plain number', async () => {
    const user = userEvent.setup();
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-01-31' } });
    await user.click(screen.getByLabelText('EUR'));

    // The browser reads this as Infinity, which would be sent as "no amount".
    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '1e400' } });
    expect(button('Record payment')).toBeDisabled();
    expect(screen.getByText('Enter the amount as a plain number with at most two decimal places.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '10.005' } });
    expect(button('Record payment')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '10.50' } });
    expect(button('Record payment')).not.toBeDisabled();
    expect(screen.queryByText('Enter the amount as a plain number with at most two decimal places.')).not.toBeInTheDocument();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('sends exactly the contract body without an amount, then reports and reloads', async () => {
    const user = userEvent.setup();
    await renderDialog();

    fireEvent.change(screen.getByLabelText('Received on'), { target: { value: '2026-11-18' } });
    await user.click(screen.getByLabelText('Cheque'));
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: '  CHQ 0042 ' } });
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-11-30' } });
    await user.click(button('Record payment')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(RECORD_URL, {
        tenant_id: 5,
        paid_until: '2027-11-30',
        received_on: '2026-11-18',
        method: 'cheque',
        reference: 'CHQ 0042',
        amount: null,
        currency: null,
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Payment recorded'));
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('sends an empty reference as null', async () => {
    const user = userEvent.setup();
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-01-31' } });

    await user.click(button('Record payment')!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(RECORD_URL, expect.objectContaining({ reference: null, method: 'bank_transfer', received_on: today() })));
  });

  it('will not send an amount without its currency', async () => {
    const user = userEvent.setup();
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-01-31' } });

    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '480.50' } });

    expect(button('Record payment')).toBeDisabled();
    expect(screen.getByText('Choose the currency of the amount.')).toBeInTheDocument();

    await user.click(screen.getByLabelText('GBP'));
    expect(button('Record payment')).not.toBeDisabled();
    await user.click(button('Record payment')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(RECORD_URL, expect.objectContaining({ amount: 480.5, currency: 'GBP' }));
    });
  });

  it('shows the server’s own refusal and stays open', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'The date it was received cannot be in the future.', code: 'PAYMENT_RECEIVED_ON_INVALID' });
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-01-31' } });

    await user.click(button('Record payment')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The date it was received cannot be in the future.'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('lists the payments already recorded by hand', async () => {
    servePayments([
      makePayment(),
      makePayment({ id: 2, received_on: '2025-11-01', method: 'cash', reference: null, amount: null, currency: null, paid_until_before: null, paid_until_after: '2026-10-31', recorded_by_name: null }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('INV-2026-114')).toBeInTheDocument());
    expect(screen.getByText(formatDate('2026-11-02'))).toBeInTheDocument();
    expect(screen.getByText(formatDate('2027-10-31'))).toBeInTheDocument();
    expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Cash').length).toBeGreaterThan(1);
    expect(screen.getByText((text) => text.includes('480'))).toBeInTheDocument();
    expect(screen.getByText('Pat Murphy')).toBeInTheDocument();
    expect(screen.queryByText('No payments have been recorded yet.')).not.toBeInTheDocument();
  });

  it('shows a card payment Stripe reported, and names Stripe as its recorder', async () => {
    servePayments([
      makePayment({ id: 9, method: 'card', reference: 'in_1QxCardInvoice', recorded_by_user_id: null, recorded_by_name: null, source: 'card' }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('in_1QxCardInvoice')).toBeInTheDocument());
    expect(screen.getByText('Stripe (card payment)')).toBeInTheDocument();
  });

  it('says who a payment was made to when it was not the platform', async () => {
    servePayments([
      makePayment({ id: 4, reference: 'HUB-INV-7', payee_tenant_id: 3, payee_name: 'Munster Hub' }),
      makePayment({ id: 5, reference: 'PLATFORM-INV-2' }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('HUB-INV-7')).toBeInTheDocument());
    expect(screen.getAllByText('Paid to Munster Hub')).toHaveLength(1);
  });

  it('says what was refunded of a card payment and how a dispute on it stands', async () => {
    servePayments([
      makePayment({
        id: 9, method: 'card', reference: 'in_1QxCardInvoice', amount: '420.00', currency: 'GBP', source: 'card', can_void: false,
        refunded_amount: '120.00', refunded_at: '2026-11-20 09:00:00', dispute_state: 'open', disputed_at: '2026-11-21 14:00:00',
      }),
      makePayment({ id: 8, method: 'card', reference: 'in_1QxLost', source: 'card', can_void: false, dispute_state: 'lost', disputed_at: '2026-10-01 10:00:00' }),
      makePayment({ id: 7, method: 'card', reference: 'in_1QxWon', source: 'card', can_void: false, dispute_state: 'won', disputed_at: '2026-09-01 10:00:00' }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('in_1QxCardInvoice')).toBeInTheDocument());
    expect(screen.getByText((text) => text.startsWith('Refunded:') && text.includes('120') && text.includes(formatDate('2026-11-20 09:00:00')))).toBeInTheDocument();
    expect(screen.getByText(`Disputed on ${formatDate('2026-11-21 14:00:00')}. Open: it is answered in Stripe.`)).toBeInTheDocument();
    expect(screen.getByText(`Disputed on ${formatDate('2026-10-01 10:00:00')}. Lost: the money went back to the cardholder.`)).toBeInTheDocument();
    expect(screen.getByText(`Disputed on ${formatDate('2026-09-01 10:00:00')}. Ended: the payment stands.`)).toBeInTheDocument();
  });

  // ── Voiding ───────────────────────────────────────────────────────────────

  it('offers to void a payment recorded by hand, and not a card payment or one already voided', async () => {
    servePayments([
      makePayment({ id: 3, received_on: '2026-11-02' }),
      makePayment({ id: 9, received_on: '2026-11-18', method: 'card', reference: 'in_1QxCardInvoice', source: 'card', can_void: false }),
      makePayment({ id: 2, received_on: '2026-10-01', can_void: false, voided_at: '2026-10-02 09:00:00', voided_by_name: 'Pat Murphy', void_reason: 'Typed twice' }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('in_1QxCardInvoice')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^Void the payment received/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Void the payment received ${formatDate('2026-11-02')}` })).toBeInTheDocument();
    expect(screen.getByText('A card payment cannot be voided here. It is refunded in Stripe.')).toBeInTheDocument();
  });

  it('shows a voided payment struck through, with who voided it, when and why', async () => {
    servePayments([
      makePayment({ id: 2, reference: 'INV-VOIDED', can_void: false, voided_at: '2026-11-03 09:00:00', voided_by_name: 'Pat Murphy', void_reason: 'Recorded against the wrong community' }),
    ]);
    await renderDialog();

    await waitFor(() => expect(screen.getByText('INV-VOIDED')).toBeInTheDocument());
    expect(screen.getByText('INV-VOIDED').className).toContain('line-through');
    expect(screen.getByText(`Voided ${formatDate('2026-11-03 09:00:00')} by Pat Murphy: Recorded against the wrong community`)).toBeInTheDocument();
  });

  it('voids with a reason and says nothing about the date when none is chosen', async () => {
    const user = userEvent.setup();
    servePayments([makePayment({ id: 3, received_on: '2026-11-02' })]);
    mockApi.post.mockResolvedValue({ success: true, data: { standing: { paid_until: '2026-12-31' } } });
    await renderDialog();

    await user.click(await screen.findByRole('button', { name: /^Void the payment received/ }));
    expect(screen.getByText('Void a payment')).toBeInTheDocument();
    expect(screen.getByText('Voiding does not change the paid-until date. If the date should change, set it below.')).toBeInTheDocument();
    // Nothing can be sent without a reason.
    expect(button('Void payment')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Why it is being voided'), { target: { value: 'Typed against the wrong community' } });
    await user.click(button('Void payment')!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledTimes(1));
    expect(mockApi.post).toHaveBeenCalledWith(VOID_URL, { tenant_id: 5, payment_id: 3, reason: 'Typed against the wrong community' });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Payment voided'));
    expect(onVoided).toHaveBeenCalledTimes(1);
    // The dialog stays open on the history, which is asked for again.
    expect(onRecorded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Record a payment')).toBeInTheDocument();
  });

  it('sends the new paid-until date when one is chosen while voiding', async () => {
    const user = userEvent.setup();
    servePayments([makePayment({ id: 3, paid_until_before: '2026-10-31' })]);
    mockApi.post.mockResolvedValue({ success: true, data: { standing: { paid_until: '2026-10-31' } } });
    await renderDialog('2027-10-31');

    await user.click(await screen.findByRole('button', { name: /^Void the payment received/ }));
    expect(screen.getByText((text) => text.includes(`Paid until now: ${formatDate('2027-10-31')}.`) && text.includes(`Before this payment it was ${formatDate('2026-10-31')}.`))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Why it is being voided'), { target: { value: 'The transfer was returned' } });
    fireEvent.change(screen.getByLabelText('New paid-until date (optional)'), { target: { value: '2026-10-31' } });
    await user.click(button('Void payment')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(VOID_URL, { tenant_id: 5, payment_id: 3, reason: 'The transfer was returned', paid_until: '2026-10-31' });
    });
    // Back on the form, the date it says the community is paid until is the new one.
    await waitFor(() => expect(screen.getByText((text) => text.includes(formatDate('2026-10-31')) && text.startsWith('Currently paid until'))).toBeInTheDocument());
  });

  it('goes back to the form without voiding anything', async () => {
    const user = userEvent.setup();
    servePayments([makePayment()]);
    await renderDialog();

    await user.click(await screen.findByRole('button', { name: /^Void the payment received/ }));
    await user.click(button('Back')!);

    expect(mockApi.post).not.toHaveBeenCalled();
    expect(screen.getByText('Record a payment')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server\'s own words when it refuses to void', async () => {
    const user = userEvent.setup();
    servePayments([makePayment()]);
    mockApi.post.mockResolvedValue({ success: false, error: 'That payment has already been voided.', code: 'PAYMENT_ALREADY_VOIDED' });
    await renderDialog();

    await user.click(await screen.findByRole('button', { name: /^Void the payment received/ }));
    fireEvent.change(screen.getByLabelText('Why it is being voided'), { target: { value: 'Why' } });
    await user.click(button('Void payment')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('That payment has already been voided.'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(onVoided).not.toHaveBeenCalled();
    // Still on the void form, so the reason is not lost.
    expect(screen.getByText('Void a payment')).toBeInTheDocument();
  });

  it('says so when there is no payment yet', async () => {
    await renderDialog();

    await waitFor(() => expect(screen.getByText('No payments have been recorded yet.')).toBeInTheDocument());
  });

  it('says so when the history cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'boom' });
    await renderDialog();

    await waitFor(() => expect(screen.getByText('The payment history could not be loaded.')).toBeInTheDocument());
  });
});
