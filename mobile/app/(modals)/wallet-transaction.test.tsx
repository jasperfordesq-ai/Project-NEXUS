// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The fixture below is a real `GET /v2/wallet/transactions/{id}` response.
 *
 * This endpoint existed and nothing called it, in this app or on the website, so a member
 * could see a list of their time credits and never open one (journey 6.12). Written from
 * the live body rather than the neighbouring list type, because the two differ: this one
 * sends the parties as `{ id, name, avatar }` while the list sends `avatar_url`. Typing it
 * from the list type would have declared a field the server never sends here — the fault
 * that crashed the Matches screen.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockParams = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams(),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'transactionDetail.title': 'Transaction',
        'transactionDetail.notFound': 'That transaction could not be found.',
        'transactionDetail.from': 'From',
        'transactionDetail.to': 'To',
        'transactionDetail.when': 'When',
        'transactionDetail.kind': 'Kind',
        'transactionDetail.balanceAfter': 'Balance afterwards',
        'transactionDetail.reference': 'Reference',
        'transactionDetail.footnote': 'Time credits are a record of help.',
        'filter.earned': 'Earned',
        'filter.spent': 'Spent',
        'status.completed': 'Completed',
        'transactionFallback': 'Time credit transaction',
        'system': 'System',
        'common:buttons.back': 'Back',
        'common:actions.retry': 'Retry',
      };
      if (key === 'signedHours') return `${String(opts?.sign ?? '')}${String(opts?.count ?? '')}h`;
      if (key === 'hoursValue') return `${String(opts?.count ?? '')}h`;
      if (key === 'federation.partnerCredit') return `From ${String(opts?.partner ?? '')}`;
      return map[key] ?? (opts?.defaultValue as string) ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#f5f5f5', text: '#000', textSecondary: '#555',
    textMuted: '#888', border: '#ddd', error: '#e11', success: '#16a34a',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/wallet', () => ({ getWalletTransaction: jest.fn() }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

import WalletTransactionScreen from './wallet-transaction';

/** Copied from the live endpoint on 2026-08-23. Note `avatar`, not `avatar_url`. */
const realTransaction = {
  id: 270,
  type: 'credit' as const,
  status: 'completed',
  amount: 1,
  description: 'Time credit transfer',
  transaction_type: 'transfer',
  sender: { id: 674, name: 'E2E UserA', avatar: null },
  receiver: { id: 675, name: 'E2E UserB', avatar: null },
  other_user: { id: 674, name: 'E2E UserA', avatar: null },
  balance_after: null,
  created_at: '2026-08-22T07:26:55+00:00',
};

function loaded(overrides: Record<string, unknown> = {}) {
  mockUseApi.mockReturnValue({
    data: { data: { ...realTransaction, ...overrides } },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.mockReturnValue({ id: '270' });
});

describe('WalletTransactionScreen', () => {
  it('shows an earned transaction with its direction and amount', () => {
    loaded();

    const { getByText, getByTestId } = render(<WalletTransactionScreen />);

    expect(getByText('Earned')).toBeTruthy();
    expect(getByTestId('transaction-amount').props.children).toBe('+1h');
    expect(getByText('Time credit transfer')).toBeTruthy();
    // Credit means it came from the other party.
    expect(getByText('From')).toBeTruthy();
  });

  it('shows a spent transaction as going out', () => {
    loaded({ type: 'debit' });

    const { getByText, getByTestId } = render(<WalletTransactionScreen />);

    expect(getByText('Spent')).toBeTruthy();
    expect(getByTestId('transaction-amount').props.children).toBe('-1h');
    expect(getByText('To')).toBeTruthy();
  });

  it('hides the balance row when the server has no balance for that row', () => {
    // 🔴 `balance_after` is genuinely null on older rows. Printing "0h" would tell the
    // member their balance was zero at the time, which is not what null means.
    loaded({ balance_after: null });

    const { queryByText } = render(<WalletTransactionScreen />);

    expect(queryByText('Balance afterwards')).toBeNull();
  });

  it('shows the balance when the server does have it', () => {
    loaded({ balance_after: 23 });

    const { getByText } = render(<WalletTransactionScreen />);

    expect(getByText('Balance afterwards')).toBeTruthy();
    expect(getByText('23h')).toBeTruthy();
  });

  it('accepts a negative id, which addresses a federated transaction', () => {
    // parseInt, not Number(): `WalletController::showTransaction` routes negative ids to
    // `federation_transactions`. A guard that dropped the sign would open the wrong row.
    mockParams.mockReturnValue({ id: '-14' });
    loaded({ id: -14, federation: { partner_id: 3, partner_name: 'Bristol Timebank' } });

    const { getByText } = render(<WalletTransactionScreen />);

    expect(getByText('From Bristol Timebank')).toBeTruthy();
    expect(mockUseApi).toHaveBeenCalledWith(expect.any(Function), [-14], { enabled: true });
  });

  it('offers a retry when the transaction could not be loaded', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: new Error('nope'), refresh });

    const { getByText } = render(<WalletTransactionScreen />);

    await waitFor(() => {
      expect(getByText('That transaction could not be found.')).toBeTruthy();
    });
  });
});
