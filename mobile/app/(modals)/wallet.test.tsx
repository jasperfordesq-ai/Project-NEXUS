// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

// --- Mocks ---

const mockSearchParams = jest.fn(() => ({}));
const mockGetWalletTransactions = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockSearchParams(),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Wallet',
        'back': 'Back',
        'eyebrow': 'Time credit wallet',
        'subtitle': 'Track your balance, giving, spending, and time-credit activity.',
        'refresh': 'Refresh wallet',
        'yourBalance': 'Your balance',
        'hours': 'hours',
        'timeCredits': 'Time Credits',
        'noTransactions': 'No transactions yet.',
        'noTransactionsDesc': 'Your earned and spent time credits will appear here.',
        'noFilteredTransactions': 'No matching transactions',
        'noFilteredTransactionsDesc': 'Try another filter to see more wallet activity.',
        'hrs': 'hrs',
        'sendCredits': 'Send credits',
        'donate': 'Donate',
        'noPending': 'No pending credits',
        'pendingIn': `${String(opts?.hours ?? '')} coming in`,
        'pendingOut': `${String(opts?.hours ?? '')} going out`,
        'pendingInOut': `${String(opts?.in ?? '')} coming in, ${String(opts?.out ?? '')} going out`,
        'communityFund': 'Community fund',
        'communityFundDesc': 'Shared credits available for community support.',
        'history': 'Transaction history',
        'historySubtitle': 'Review earned, spent, and pending activity.',
        'export': 'Export',
        'loadMore': 'Load more transactions',
        'system': 'System',
        'transactionFallback': 'Time credit transaction',
        'transactionLabel': `${String(opts?.name ?? '')}, ${String(opts?.amount ?? '')}`,
        'hoursValue': `${String(opts?.count ?? '')}h`,
        'signedHours': `${String(opts?.sign ?? '')}${String(opts?.count ?? '')}h`,
        'unableToLoad': 'Unable to load wallet',
        'tryAgain': 'Try again',
        'stats.earned': 'Earned',
        'stats.spent': 'Spent',
        'stats.pending': 'Pending',
        'filter.all': 'All',
        'filter.earned': 'Earned',
        'filter.spent': 'Spent',
        'filter.pending': 'Pending',
        'fund.balance': 'Fund',
        'fund.deposited': 'Deposited',
        'fund.donated': 'Donated',
        'actions.transferTitle': 'Send credits',
        'actions.transferSubtitle': 'Search for a member, choose an amount, and send time credits securely.',
        'actions.donateTitle': 'Donate credits',
        'actions.donateSubtitle': 'Support the community fund or send a donation to another member.',
        'actions.closeAction': 'Close wallet action',
        'actions.selectedRecipient': 'Selected recipient',
        'actions.memberFallback': 'Community member',
        'actions.recipientSearch': 'Recipient search',
        'actions.recipientSearchPlaceholder': 'Search by name or email',
        'actions.searchMembers': 'Search members',
        'actions.amount': 'Amount',
        'actions.amountPlaceholder': 'Hours to send',
        'actions.description': 'Description',
        'actions.descriptionPlaceholder': 'What is this transfer for?',
        'actions.sendNow': 'Send credits',
        'actions.loadMoreFailedTitle': 'Could not load more',
        'actions.loadMoreFailedMessage': 'We could not load more transactions right now.',
        'status.completed': 'Completed',
        'status.pending': 'Pending',
        'federation.credit': 'Federation credit',
        'federation.partnerCredit': `${String(opts?.partner ?? '')} credit`,
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  /**
   * 🔴 Falls back when the queue runs out, on purpose.
   *
   * Every test below sets up exactly three `mockReturnValueOnce` calls for the balance,
   * transactions and community-fund queries. The screen gained a FOURTH `useApi` on
   * 2026-08-23 (the pending-transactions query) and all thirteen tests broke at once with
   * "Cannot read properties of undefined" — a harness failure that reads like a screen
   * crash. A fallback keeps the next added query from taking the suite down.
   */
  useApi: (...args: unknown[]) =>
    mockUseApi(...args) ?? { data: null, isLoading: false, error: null, refresh: () => {} },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/wallet', () => ({
  getCommunityFundBalance: jest.fn(),
  getWalletBalance: jest.fn(),
  getWalletTransactions: (...args: unknown[]) => mockGetWalletTransactions(...args),
  donateWalletCredits: jest.fn(),
  searchWalletUsers: jest.fn(),
  transferWalletCredits: jest.fn(),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: jest.fn(), hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <View testID="wallet-action-sheet">{children}</View> : null;
});

// --- Tests ---

import WalletModal from './wallet';
import { searchWalletUsers } from '@/lib/api/wallet';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockSearchParams.mockReturnValue({});
  mockGetWalletTransactions.mockReset();
  mockUseApi
    .mockReset()
    .mockReturnValueOnce(defaultApiState)
    .mockReturnValueOnce(defaultApiState)
    .mockReturnValueOnce(defaultApiState)
    // 🔴 A trailing default, not a fourth `Once`. The screen gained a fourth `useApi`
    // (the pending-transactions query) on 2026-08-23 and every test in this file broke,
    // because the chain ran out and returned undefined. A default means the next one
    // added here does not take the suite down with it.
    .mockReturnValue(defaultApiState);
});

const mockTransaction = {
  id: 101,
  type: 'credit' as const,
  amount: 2.5,
  description: 'Tutoring session',
  status: 'completed' as const,
  created_at: '2026-02-14T10:00:00Z',
  other_user: { id: 5, name: 'Bob Smith', avatar_url: null },
};

const mockPendingTransaction = {
  id: 103,
  type: 'credit' as const,
  amount: 7,
  description: 'Pending inbound fixture',
  status: 'pending' as const,
  created_at: '2026-08-23T09:00:00Z',
  other_user: { id: 5, name: 'Bob Smith', avatar_url: null },
};

const mockDebitTransaction = {
  id: 102,
  type: 'debit' as const,
  amount: 1.0,
  description: 'Garden help',
  status: 'completed' as const,
  created_at: '2026-02-15T12:00:00Z',
  other_user: { id: 6, name: 'Carol Jones', avatar_url: null },
};

const mockFederationTransaction = {
  id: -12,
  source: 'federation' as const,
  type: 'credit' as const,
  amount: 3,
  description: 'Partner referral support',
  status: 'completed' as const,
  transaction_type: 'federation',
  category_id: null,
  created_at: '2026-02-16T12:00:00Z',
  other_user: { id: 0, name: 'Maria Lopez (TimeOverflow)', avatar_url: null },
  federation: {
    transaction_id: 12,
    partner_id: 4,
    partner_name: 'TimeOverflow',
    external_sender_name: 'Maria Lopez',
  },
};

describe('WalletModal', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<WalletModal />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the Time Credits label', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('Your balance')).toBeTruthy();
  });

  it('renders the balance value when loaded', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('12.5')).toBeTruthy();
  });

  it('renders empty state when there are no transactions', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 0.0, total_credits: 0, total_debits: 0, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 0 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('No transactions yet.')).toBeTruthy();
  });

  it('renders transaction rows when transactions are available', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [mockTransaction] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('Tutoring session')).toBeTruthy();
    expect(getByText('Bob Smith')).toBeTruthy();
  });

  it('renders credit amount with + sign', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [mockTransaction] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('+2.5h')).toBeTruthy();
  });

  it('renders debit transaction row', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [mockDebitTransaction] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('Carol Jones')).toBeTruthy();
    expect(getByText('Garden help')).toBeTruthy();
  });

  it('opens the transfer panel with a recipient from query params', () => {
    mockSearchParams.mockReturnValue({ to: '260', name: 'Jasper Ford' });
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('Jasper Ford')).toBeTruthy();
    expect(getByText('Selected recipient')).toBeTruthy();
  });

  it('opens the transfer panel when recipient query params arrive on a mounted wallet', () => {
    const walletState = { data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const routeParams: { current: Record<string, string> } = { current: {} };
    let apiCall = 0;

    mockSearchParams.mockImplementation(() => routeParams.current);
    mockUseApi
      .mockReset()
      .mockImplementation(() => {
        // 🔴 The cycle length MUST equal the number of useApi calls in the screen.
        // With three states and four queries the mapping stayed correct on the first
        // render and then slid by one on every render after it, handing the transactions
        // query the community-fund payload — which is not a list, and took the wallet down
        // inside its error boundary. Add a state here whenever the screen adds a query.
        const states = [walletState, transactionsState, fundState, pendingState];
        const state = states[apiCall % states.length];
        apiCall += 1;
        return state;
      });

    const { queryByText, rerender, getByText } = render(<WalletModal />);
    expect(queryByText('Recipient search')).toBeNull();

    routeParams.current = { to: '260', name: 'Jasper Ford' };
    rerender(<WalletModal />);

    expect(getByText('Jasper Ford')).toBeTruthy();
    expect(getByText('Selected recipient')).toBeTruthy();
  });

  it('opens wallet transfer actions inline under the balance card', () => {
    const walletState = { data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi
      .mockReset()
      .mockImplementation(() => {
        // 🔴 The cycle length MUST equal the number of useApi calls in the screen.
        // With three states and four queries the mapping stayed correct on the first
        // render and then slid by one on every render after it, handing the transactions
        // query the community-fund payload — which is not a list, and took the wallet down
        // inside its error boundary. Add a state here whenever the screen adds a query.
        const states = [walletState, transactionsState, fundState, pendingState];
        const state = states[apiCall % states.length];
        apiCall += 1;
        return state;
      });

    const { getByText } = render(<WalletModal />);

    fireEvent.press(getByText('Send credits'));

    expect(getByText('Recipient search')).toBeTruthy();
  });

  it('accepts transfer amount and description through shared input fields', () => {
    mockSearchParams.mockReturnValue({ to: '260', name: 'Jasper Ford' });
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByDisplayValue, getByPlaceholderText } = render(<WalletModal />);

    fireEvent.changeText(getByPlaceholderText('Hours to send'), '2');
    fireEvent.changeText(getByPlaceholderText('What is this transfer for?'), 'Garden help');

    expect(getByDisplayValue('2')).toBeTruthy();
    expect(getByDisplayValue('Garden help')).toBeTruthy();
  });

  it('selects transfer recipients from HeroUI Native-backed search result rows', async () => {
    const walletState = { data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    jest.mocked(searchWalletUsers).mockResolvedValueOnce({
      data: {
        users: [
          { id: 42, name: 'Alice Smith', avatar_url: null, email: 'alice@example.test' },
        ],
      },
    } as never);
    mockUseApi
      .mockReset()
      .mockImplementation(() => {
        // 🔴 The cycle length MUST equal the number of useApi calls in the screen.
        // With three states and four queries the mapping stayed correct on the first
        // render and then slid by one on every render after it, handing the transactions
        // query the community-fund payload — which is not a list, and took the wallet down
        // inside its error boundary. Add a state here whenever the screen adds a query.
        const states = [walletState, transactionsState, fundState, pendingState];
        const state = states[apiCall % states.length];
        apiCall += 1;
        return state;
      });

    const { findByText, getByPlaceholderText, getByText } = render(<WalletModal />);

    fireEvent.press(getByText('Send credits'));
    fireEvent.changeText(getByPlaceholderText('Search by name or email'), 'Alice');
    fireEvent.press(getByText('Search members'));

    fireEvent.press(await findByText('Alice Smith'));

    expect(await findByText('Selected recipient')).toBeTruthy();
    expect(searchWalletUsers).toHaveBeenCalledWith('Alice', 10);
  });

  it('loads the next transaction page when more history is available', async () => {
    const walletState = { data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [mockTransaction], meta: { cursor: 'next-page', has_more: true } }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockGetWalletTransactions.mockResolvedValueOnce({
      data: [mockDebitTransaction],
      meta: { per_page: 50, has_more: false, cursor: null },
    });
    mockUseApi
      .mockReset()
      .mockImplementation(() => {
        // 🔴 The cycle length MUST equal the number of useApi calls in the screen.
        // With three states and four queries the mapping stayed correct on the first
        // render and then slid by one on every render after it, handing the transactions
        // query the community-fund payload — which is not a list, and took the wallet down
        // inside its error boundary. Add a state here whenever the screen adds a query.
        const states = [walletState, transactionsState, fundState, pendingState];
        const state = states[apiCall % states.length];
        apiCall += 1;
        return state;
      });

    const { getByText } = render(<WalletModal />);
    fireEvent.press(getByText('Load more transactions'));

    await waitFor(() => expect(mockGetWalletTransactions).toHaveBeenCalledWith('next-page', 50, 'all'));
    await waitFor(() => expect(getByText('Garden help')).toBeTruthy());
  });

  it('labels federation wallet credits with the partner name', () => {
    mockUseApi
      .mockReset()
      .mockReturnValueOnce({ data: { data: { balance: 12.5, total_credits: 20, total_debits: 7.5, currency: 'hours' } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [mockFederationTransaction] }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<WalletModal />);
    expect(getByText('Partner referral support')).toBeTruthy();
    expect(getByText('TimeOverflow credit')).toBeTruthy();
  });
  /**
   * 🔴 Pending IN and pending OUT were ADDED TOGETHER and shown as one figure.
   *
   * Credits coming in and credits going out are opposite directions, so their sum is
   * neither. Measured on a device 2026-08-23 with 7 in and 4 out: the wallet read
   * "11 pending" in the chip and "PENDING 11h" in the tile, beside EARNED "+3h" and SPENT
   * "-5h" which do carry a direction. 11 is not a number the member has anywhere.
   */
  function walletWithPending(pendingIn: number, pendingOut: number) {
    const walletState = {
      data: { data: { balance: 23, total_earned: 3, total_spent: 5, pending_in: pendingIn, pending_out: pendingOut } },
      isLoading: false, error: null, refresh: jest.fn(),
    };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3, total_deposited: 5, total_donated: 2 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [mockPendingTransaction] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockReset().mockImplementation(() => {
      const states = [walletState, transactionsState, fundState, pendingState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });
  }

  /**
   * 🔴 In a community without external federation, NOTHING ever writes a pending credit —
   * measured 2026-08-24: `WalletService` settles both insert paths as `completed`, and the
   * only producer of `transactions.status = 'pending'` is `FederationController`, which is
   * off by default and has never had a partner connected. So for practically every member
   * the Pending filter could only ever answer "No matching transactions": a control that
   * looks live and leads nowhere. It is offered when there is something pending, and not
   * otherwise — the balance card still says "No pending credits", so the absence is stated.
   */
  it('offers the Pending filter only when something is pending', () => {
    walletWithPending(0, 0);
    const none = render(<WalletModal />);
    expect(none.queryByTestId('wallet-filter-pending')).toBeNull();
    // The other filters are untouched, and the stat tile still states the zero.
    expect(none.queryByTestId('wallet-filter-all')).toBeTruthy();
    expect(none.getByText('No pending credits')).toBeTruthy();
    none.unmount();

    walletWithPending(0, 4);
    const some = render(<WalletModal />);
    expect(some.queryByTestId('wallet-filter-pending')).toBeTruthy();
  });

  it('never adds pending in and pending out together', () => {
    walletWithPending(7, 4);

    const { getByTestId, queryByText } = render(<WalletModal />);

    expect(getByTestId('wallet-pending-chip').props.children)
      .toBe('7 coming in, 4 going out');
    // 11 is the sum, and it is not a figure the member has anywhere.
    expect(queryByText('11 pending')).toBeNull();
    expect(queryByText('11h')).toBeNull();
  });

  it('names the direction when only one side is pending', () => {
    walletWithPending(0, 4);
    const outOnly = render(<WalletModal />);
    expect(outOnly.getByTestId('wallet-pending-chip').props.children).toBe('4 going out');
    outOnly.unmount();

    walletWithPending(6, 0);
    const inOnly = render(<WalletModal />);
    expect(inOnly.getByTestId('wallet-pending-chip').props.children).toBe('6 coming in');
  });

  /**
   * 🔴 The Pending filter answered "No matching transactions" while the tile beside it
   * claimed hours were pending. `GET /v2/wallet/transactions` was hard-scoped to completed
   * rows for every filter, so nothing could ever appear there — in this app or on the
   * website. The server now honours `type=pending`, and this screen must ask for it.
   */
  it('asks the server for pending rows when the member selects the Pending filter', () => {
    // A source assertion, deliberately: `useApi` is mocked here and never runs the factory,
    // so pressing the chip could not prove which request is made. What must not regress is
    // that the pending filter has its OWN request with `type: 'pending'` — the default list
    // is completed-only on purpose, because clients derive earned/spent from it.
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, 'wallet.tsx'),
      'utf8',
    );
    expect(source).toContain("getWalletTransactions(undefined, 50, 'pending')");
    expect(source).toContain("enabled: filter === 'pending'");
    expect(source).toContain("if (filter === 'pending') return pendingTransactions;");
  });

  it('refreshes pending transactions with the rest of the wallet', () => {
    const walletState = { data: { data: { balance: 23, pending_in: 7, pending_out: 0 } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [mockPendingTransaction] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockReset().mockImplementation(() => {
      const states = [walletState, transactionsState, fundState, pendingState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const { getByLabelText } = render(<WalletModal />);
    fireEvent.press(getByLabelText('Refresh wallet'));

    expect(walletState.refresh).toHaveBeenCalledTimes(1);
    expect(transactionsState.refresh).toHaveBeenCalledTimes(1);
    expect(fundState.refresh).toHaveBeenCalledTimes(1);
    expect(pendingState.refresh).toHaveBeenCalledTimes(1);
  });

  it('stops the pull-to-refresh indicator only when every wallet request has completed', () => {
    const walletState = { data: { data: { balance: 23 } }, isLoading: false, error: null, refresh: jest.fn() };
    const transactionsState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const fundState = { data: { data: { balance: 3 } }, isLoading: false, error: null, refresh: jest.fn() };
    const pendingState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    let apiCall = 0;
    mockUseApi.mockReset().mockImplementation(() => {
      const states = [walletState, transactionsState, fundState, pendingState];
      const state = states[apiCall % states.length];
      apiCall += 1;
      return state;
    });

    const screen = render(<WalletModal />);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');

    walletState.isLoading = true;
    transactionsState.isLoading = true;
    fundState.isLoading = true;
    screen.rerender(<WalletModal />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);

    walletState.isLoading = false;
    transactionsState.isLoading = false;
    fundState.isLoading = false;
    screen.rerender(<WalletModal />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });
});
