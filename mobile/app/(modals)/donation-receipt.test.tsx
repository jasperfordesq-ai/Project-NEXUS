// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

let mockParams: Record<string, string | string[]> = {};
let mockUserId = 10;
let mockTenantId = 2;

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'donations.receipt_title': 'Donation receipt',
      'donations.receipt_not_found': 'Receipt not found.',
      'donations.receipt_ref': `Ref ${String(values?.ref ?? '')}`,
      'donations.receipt_donor': 'Donor',
      'donations.receipt_date': 'Date',
      'donations.receipt_community': 'Community',
      'donations.receipt_method': 'Payment method',
      'donations.payment_methods.bank_transfer': 'bank transfer',
      'donations.receipt_message': 'Message',
      'donations.status.completed': 'Completed',
      'common:buttons.retry': 'Retry',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: mockTenantId, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/donations', () => ({ getDonationReceipt: jest.fn() }));

import DonationReceiptScreen from './donation-receipt';
import { getDonationReceipt } from '@/lib/api/donations';
import { ApiResponseError } from '@/lib/api/client';

const receipt = {
  id: 12,
  donor_name: 'Ada Member',
  amount: 25,
  currency: 'EUR',
  date: '2026-08-01T10:00:00Z',
  community_name: 'Hour Timebank',
  message: 'Keep up the good work',
  status: 'completed' as const,
  payment_method: 'Card',
  reference: 'DON-12',
};

describe('DonationReceiptScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '12' };
    mockUserId = 10;
    mockTenantId = 2;
    jest.mocked(getDonationReceipt).mockResolvedValue(receipt as never);
  });

  it.each(['account', 'community', 'receipt'])('discards a loaded receipt when the %s changes', async (identity) => {
    const screen = render(<DonationReceiptScreen />);
    await screen.findByText('Ada Member');
    let finish!: (value: typeof receipt) => void;
    jest.mocked(getDonationReceipt).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    if (identity === 'account') mockUserId = 11;
    if (identity === 'community') mockTenantId = 3;
    if (identity === 'receipt') mockParams = { id: '13' };
    screen.rerender(<DonationReceiptScreen />);
    expect(screen.queryByText('Ada Member')).toBeNull();
    expect(getDonationReceipt).toHaveBeenCalledTimes(2);
    await act(async () => finish({ ...receipt, donor_name: 'Current Member' }));
    expect(await screen.findByText('Current Member')).toBeTruthy();
  });

  it.each(['account', 'community', 'receipt'])('ignores a late receipt response after the %s changes', async (identity) => {
    let finishOld!: (value: typeof receipt) => void;
    jest.mocked(getDonationReceipt).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const screen = render(<DonationReceiptScreen />);
    jest.mocked(getDonationReceipt).mockResolvedValue({ ...receipt, donor_name: 'Current Member' });
    if (identity === 'account') mockUserId = 11;
    if (identity === 'community') mockTenantId = 3;
    if (identity === 'receipt') mockParams = { id: '13' };
    screen.rerender(<DonationReceiptScreen />);
    await act(async () => finishOld(receipt));
    expect(screen.queryByText('Ada Member')).toBeNull();
    expect(await screen.findByText('Current Member')).toBeTruthy();
  });

  it('renders the receipt detail for the requested donation', async () => {
    const { getByText } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByText('Ada Member')).toBeTruthy());
    expect(getDonationReceipt).toHaveBeenCalledWith(12);
    expect(getByText('Ref DON-12')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Hour Timebank')).toBeTruthy();
    expect(getByText('Keep up the good work')).toBeTruthy();
  });

  it('renders a translated known payment method rather than its wire code', async () => {
    jest.mocked(getDonationReceipt).mockResolvedValue({ ...receipt, payment_method: 'bank_transfer' });
    const screen = render(<DonationReceiptScreen />);
    expect(await screen.findByText('bank transfer')).toBeTruthy();
    expect(screen.queryByText('bank_transfer')).toBeNull();
  });

  it('clears a previously loaded receipt after refusal and does not reveal it during a later refresh', async () => {
    const screen = render(<DonationReceiptScreen />);
    await screen.findByText('Ada Member');
    jest.mocked(getDonationReceipt).mockRejectedValueOnce(new ApiResponseError(403, 'Unavailable'));
    act(() => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
    await screen.findByTestId('donation-receipt-refused');
    expect(screen.queryByText('Ada Member')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
    let finish!: (value: typeof receipt) => void;
    jest.mocked(getDonationReceipt).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
    expect(screen.queryByText('Ada Member')).toBeNull();
    await act(async () => finish(receipt));
    expect(await screen.findByText('Ada Member')).toBeTruthy();
  });

  it('preserves a loaded receipt through a temporary refresh failure and clears the notice after retry', async () => {
    const screen = render(<DonationReceiptScreen />);
    await screen.findByText('Ada Member');
    jest.mocked(getDonationReceipt).mockRejectedValue(new ApiResponseError(500, 'Temporary failure'));
    act(() => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
    await screen.findByTestId('refresh-failed-notice', {}, { timeout: 8000 });
    expect(screen.getByText('Ada Member')).toBeTruthy();
    jest.mocked(getDonationReceipt).mockResolvedValue({ ...receipt, message: 'Refreshed receipt' });
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByText('Refreshed receipt');
    expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
  }, 15000);

  /*
    🔴 This case USED to assert that a 404 offers a Retry, and passed — pinning the
    defect in place. A receipt belongs to one member; 404 from that endpoint means
    "not yours" as often as it means "gone", and retrying it returns the same answer
    for ever. Audit 2026-09-07 F-8, corrected 2026-09-08.
  */
  it('says a receipt that is not theirs is unavailable, with no dead Retry', async () => {
    jest.mocked(getDonationReceipt).mockRejectedValue(new ApiResponseError(404, 'Receipt unavailable'));
    const { getByTestId, queryByText } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByTestId('donation-receipt-refused')).toBeTruthy());
    expect(queryByText('Retry')).toBeNull();
    expect(getDonationReceipt).toHaveBeenCalledTimes(1);
  });

  it('still offers a retry for a server failure, which retrying can fix', async () => {
    jest.mocked(getDonationReceipt).mockRejectedValue(new ApiResponseError(500, 'Server error'));
    const { getByText, queryByTestId } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByText('Retry')).toBeTruthy(), { timeout: 8000 });
    expect(queryByTestId('donation-receipt-refused')).toBeNull();
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(jest.mocked(getDonationReceipt).mock.calls.length).toBeGreaterThan(1));
  }, 15000);

  it.each([undefined, '', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740993', '1e2', '0x10', ['12', '13']])('does not fetch or offer a dead retry for invalid id %p', async id => {
    mockParams = id === undefined ? {} : { id };
    const { getByText, queryByText } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByText('Receipt not found.')).toBeTruthy());
    expect(getDonationReceipt).not.toHaveBeenCalled();
    expect(queryByText('Retry')).toBeNull();
  });
});
