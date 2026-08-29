// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
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
      'donations.receipt_message': 'Message',
      'donations.status.completed': 'Completed',
      'common:buttons.retry': 'Retry',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
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
  status: 'completed',
  payment_method: 'Card',
  reference: 'DON-12',
};

describe('DonationReceiptScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '12' };
    jest.mocked(getDonationReceipt).mockResolvedValue(receipt as never);
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

  it('offers a retry when the receipt cannot be loaded', async () => {
    jest.mocked(getDonationReceipt).mockRejectedValue(new ApiResponseError(404, 'Receipt unavailable'));
    const { getByText } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByText('Receipt unavailable')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getDonationReceipt).toHaveBeenCalledTimes(2));
  });

  it('does not call the API without a donation id', async () => {
    mockParams = {};
    const { getByText } = render(<DonationReceiptScreen />);
    await waitFor(() => expect(getByText('Receipt not found.')).toBeTruthy());
    expect(getDonationReceipt).not.toHaveBeenCalled();
  });
});
