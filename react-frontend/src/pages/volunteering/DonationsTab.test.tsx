// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DonationsTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

const translations: Record<string, string> = {
  'donations.heading': 'Donations',
  'donations.refresh': 'Refresh',
  'donations.record_pledge': 'Record a pledge',
  'donations.donate_with_card': 'Donate by card',
  'donations.load_error': 'Unable to load donations data.',
  'try_again': 'Try again',
  'donations.empty_title': 'No fundraising campaigns right now',
  'donations.empty_description': 'When a campaign is running you can donate here.',
  'donations.intro_title': 'What donations are',
  'donations.intro_desc': 'A donation is money, not time credits.',
  'donations.currency_fixed_hint': 'Donations to this community are taken in {{currency}}.',
  'donations.stats.live_campaigns': 'Live campaigns',
  'donations.stats.raised': 'Raised so far',
  'donations.stats.raised_hint': 'Across live campaigns',
  'donations.stats.you_gave': "You've given",
  'donations.stats.pending_pledges': '{{number}} pending',
  'donations.live_campaigns': 'Live campaigns',
  'donations.upcoming_campaigns': 'Coming up',
  'donations.past_campaigns': 'Past campaigns',
  'donations.past_campaigns_hint': 'Closed to new donations.',
  'donations.raised_of_goal': '{{raised}} raised of {{goal}}',
  'donations.percent_funded': '{{percent}}% funded',
  'donations.ends_on': 'Ends {{date}}',
  'donations.ended_on': 'Ended {{date}}',
  'donations.starts_on': 'Starts {{date}}',
  'donations.day_status.active': 'Active',
  'donations.day_status.upcoming': 'Upcoming',
  'donations.day_status.ended': 'Ended',
  'donations.progress_aria': 'Donation progress: {{percent}}%',
  'donations.donors_count': '{{count}} donors',
  'donations.my_donations': 'My donations',
  'donations.my_donations_hint': 'Your gifts and pledges, newest first.',
  'donations.status.completed': 'Completed',
  'donations.status.pending': 'Pending',
  'donations.status.refunded': 'Refunded',
  'donations.methods.card': 'Card',
  'donations.for_organisation': 'For {{name}}',
  'donations.methods.bank_transfer': 'Bank transfer',
  'donations.methods.paypal': 'PayPal',
  'donations.methods.cash': 'Cash',
  'donations.methods.other': 'Other',
  'donations.fund_options.general': 'General community support',
  'donations.pending_pledge_note': 'Recorded as a pledge. An administrator marks it complete once the money arrives.',
  'donations.view_receipt': 'View receipt',
  'donations.anonymous': 'Anonymous',
  'donations.pledge_intro': 'Use this for money you have sent by bank transfer, PayPal or cash.',
  'donations.form.campaign': 'Campaign',
  'donations.form.amount': 'Amount',
  'donations.form.payment_method': 'Payment method',
  'donations.form.reference': 'Payment reference (optional)',
  'donations.form.reference_hint': 'The reference you put on the transfer.',
  'donations.form.message': 'Message (optional)',
  'donations.placeholder_amount': '0.00',
  'donations.anonymous_toggle': 'Donate anonymously',
  'donations.cancel': 'Cancel',
  'donations.confirm': 'Record pledge',
  'donations.invalid_amount': 'Please enter a valid amount.',
  'donations.pledge_success': 'Pledge recorded.',
  'donations.submit_error': 'Failed to record donation.',
  'donations.submit_error_retry': 'Failed to record donation. Please try again.',
};
const stableT = (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
  const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : translations[key] ?? key;
  const vars = typeof fallbackOrOpts === 'object' ? fallbackOrOpts : opts;
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { DonationsTab } from './DonationsTab';
import { api } from '@/lib/api';

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const liveCampaign = {
  id: 1,
  title: 'Winter warmth appeal',
  description: 'Blankets and heaters for members who struggle with heating bills.',
  goal_amount: 1200,
  raised_amount: 340,
  donor_count: 3,
  start_date: inDays(-3),
  end_date: inDays(18),
  is_active: true,
  status: 'active' as const,
};

const endedCampaign = {
  id: 2,
  title: 'Autumn giving week',
  description: 'Tools and seeds for the community garden.',
  goal_amount: 500,
  raised_amount: 0,
  donor_count: 0,
  start_date: inDays(-40),
  end_date: inDays(-10),
  is_active: true,
  status: 'ended' as const,
};

const cardGift = {
  id: 7,
  amount: '25.00',
  currency: 'EUR',
  payment_method: 'stripe',
  message: 'Stay warm everyone',
  is_anonymous: 0,
  status: 'completed' as const,
  giving_day_id: 1,
  giving_day_title: 'Winter warmth appeal',
  created_at: '2026-10-03T10:00:00Z',
};

const pendingPledge = {
  id: 8,
  amount: '10.00',
  currency: 'EUR',
  payment_method: 'bank_transfer',
  message: null,
  is_anonymous: 1,
  status: 'pending' as const,
  giving_day_id: null,
  giving_day_title: null,
  created_at: '2026-10-04T10:00:00Z',
};

function mockLoad(days: unknown[], donations: unknown[]) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('giving-days')) return Promise.resolve({ success: true, data: days });
    return Promise.resolve({ success: true, data: { items: donations, next_cursor: null } });
  });
}

describe('DonationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad([], []);
  });

  it('renders the heading and the three actions', async () => {
    render(<DonationsTab />);
    expect(screen.getByRole('heading', { level: 2, name: 'Donations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record a pledge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donate by card' })).toBeInTheDocument();
    // Tells the member which currency gifts are taken in.
    expect(screen.getByText('Donations to this community are taken in EUR.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  it('shows a loading status while the first load is in flight', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<DonationsTab />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('shows the empty state with both ways to give when there is nothing yet', async () => {
    render(<DonationsTab />);
    const empty = await screen.findByTestId('empty-state');
    expect(within(empty).getByText('No fundraising campaigns right now')).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Donate by card' })).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Record a pledge' })).toBeInTheDocument();
  });

  it('puts live campaigns under Live with donate buttons and ended ones under Past without them', async () => {
    mockLoad([liveCampaign, endedCampaign], []);
    render(<DonationsTab />);
    await screen.findByText('Winter warmth appeal');

    const live = screen.getByRole('region', { name: 'Live campaigns' });
    expect(within(live).getByText('Winter warmth appeal')).toBeInTheDocument();
    expect(within(live).getByRole('button', { name: 'Donate by card' })).toBeInTheDocument();
    expect(within(live).getByRole('button', { name: 'Record a pledge' })).toBeInTheDocument();

    const past = screen.getByRole('region', { name: 'Past campaigns' });
    expect(within(past).getByText('Autumn giving week')).toBeInTheDocument();
    expect(within(past).getByText('Closed to new donations.')).toBeInTheDocument();
    expect(within(past).queryByRole('button', { name: 'Donate by card' })).not.toBeInTheDocument();
    expect(within(past).queryByRole('button', { name: 'Record a pledge' })).not.toBeInTheDocument();
  });

  it('says which organisation a campaign and a past gift are for', async () => {
    mockLoad(
      [{ ...liveCampaign, organization_id: 4, organization_name: 'Food Bank' }, endedCampaign],
      [{ ...cardGift, organization_name: 'Food Bank' }, pendingPledge],
    );
    render(<DonationsTab />);
    await screen.findByText('Winter warmth appeal', { selector: 'h4' });

    const live = screen.getByRole('region', { name: 'Live campaigns' });
    expect(within(live).getByText('For Food Bank')).toBeInTheDocument();
    // A whole-community campaign names no organisation.
    const past = screen.getByRole('region', { name: 'Past campaigns' });
    expect(within(past).queryByText(/^For /)).not.toBeInTheDocument();

    // One on the live card, one on the card gift in My donations; none on the general pledge.
    expect(screen.getAllByText('For Food Bank')).toHaveLength(2);
  });

  it('shows money in the community currency and the funding percentage', async () => {
    mockLoad([liveCampaign], []);
    render(<DonationsTab />);
    await screen.findByText('Winter warmth appeal');
    // "€340.00 raised of €1,200.00" — assert the parts so the locale symbol position cannot break it.
    expect(screen.getByText(/340\.00 raised of .*1,200\.00/)).toBeInTheDocument();
    expect(screen.getByText('28% funded')).toBeInTheDocument();
    expect(screen.getByText('3 donors')).toBeInTheDocument();
    expect(screen.getByText(/^Ends /)).toBeInTheDocument();
  });

  it('summarises live campaigns, money raised, what you have given and pending pledges', async () => {
    mockLoad([liveCampaign, endedCampaign], [cardGift, pendingPledge]);
    render(<DonationsTab />);
    await screen.findByText("You've given");

    // One live campaign (the ended one is not counted).
    const liveTile = screen.getByText('Live campaigns', { selector: 'p' }).parentElement!;
    expect(within(liveTile).getByText('1')).toBeInTheDocument();
    // Raised across live campaigns only.
    const raisedTile = screen.getByText('Raised so far').parentElement!;
    expect(within(raisedTile).getByText(/340\.00/)).toBeInTheDocument();
    // Completed gifts only, with the pending pledge mentioned.
    const givenTile = screen.getByText("You've given").parentElement!;
    expect(within(givenTile).getByText(/25\.00/)).toBeInTheDocument();
    expect(within(givenTile).getByText('1 pending')).toBeInTheDocument();
  });

  it('lists my donations with the campaign name, a readable method, a pending note and a receipt link', async () => {
    mockLoad([liveCampaign], [cardGift, pendingPledge]);
    render(<DonationsTab />);
    const section = await screen.findByRole('region', { name: 'My donations' });

    // The server records card gifts as "stripe" — the screen used to print the raw key.
    expect(within(section).getByText('Card')).toBeInTheDocument();
    expect(within(section).queryByText(/payment_methods/)).not.toBeInTheDocument();
    expect(within(section).getByText('Winter warmth appeal')).toBeInTheDocument();
    expect(within(section).getByText('Stay warm everyone')).toBeInTheDocument();
    expect(within(section).getByText(/25\.00/)).toBeInTheDocument();

    // The pledge: general support, bank transfer, anonymous, explained.
    expect(within(section).getByText('General community support')).toBeInTheDocument();
    expect(within(section).getByText('Bank transfer')).toBeInTheDocument();
    expect(within(section).getByText('Anonymous')).toBeInTheDocument();
    expect(within(section).getByText(/An administrator marks it complete/)).toBeInTheDocument();

    // Only the completed card gift has a receipt.
    const receipts = within(section).getAllByRole('link', { name: /View receipt/ });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toHaveAttribute('href', '/test/donations/7/receipt');
  });

  it('shows an error with Try again when a request fails, and retries', async () => {
    let calls = 0;
    vi.mocked(api.get).mockImplementation(() => {
      calls++;
      return calls <= 2 ? Promise.reject(new Error('fail')) : Promise.resolve({ success: true, data: [] });
    });
    const user = userEvent.setup();
    render(<DonationsTab />);
    await screen.findByText('Unable to load donations data.');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    await screen.findByTestId('empty-state');
  });

  it('shows the error state (not the empty state) when a load returns success:false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'boom', code: 'SERVER_ERROR' });
    render(<DonationsTab />);
    await screen.findByText('Unable to load donations data.');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('records a pledge without ever offering card as a method', async () => {
    mockLoad([liveCampaign], []);
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 9 } });
    const user = userEvent.setup();
    render(<DonationsTab />);
    await screen.findByText('Winter warmth appeal');

    // Header button (the first one in the document).
    await user.click(screen.getAllByRole('button', { name: 'Record a pledge' })[0]!);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('radio', { name: 'Card' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Bank transfer' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'PayPal' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Cash' })).toBeInTheDocument();

    await user.type(within(dialog).getByRole('spinbutton'), '20');
    await user.type(within(dialog).getByLabelText(/Payment reference/), 'INV-1');
    await user.click(within(dialog).getByRole('button', { name: 'Record pledge' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/donations', {
        giving_day_id: null,
        amount: 20,
        currency: 'EUR',
        payment_method: 'bank_transfer',
        payment_reference: 'INV-1',
        message: null,
        is_anonymous: false,
      }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Pledge recorded.'));
  });

  it('ties a pledge opened from a campaign card to that campaign', async () => {
    mockLoad([liveCampaign], []);
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 10 } });
    const user = userEvent.setup();
    render(<DonationsTab />);
    await screen.findByText('Winter warmth appeal');

    const live = screen.getByRole('region', { name: 'Live campaigns' });
    await user.click(within(live).getByRole('button', { name: 'Record a pledge' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByRole('spinbutton'), '15');
    await user.click(within(dialog).getByRole('button', { name: 'Record pledge' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v2/volunteering/donations',
        expect.objectContaining({ giving_day_id: 1, amount: 15 }),
      ),
    );
  });
});
