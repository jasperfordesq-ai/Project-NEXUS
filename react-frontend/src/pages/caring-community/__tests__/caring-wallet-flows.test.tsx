// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HourGiftPage } from '../HourGiftPage';
import { HourTransferPage } from '../HourTransferPage';
import { LoyaltyHistoryPage } from '../LoyaltyHistoryPage';

const toastSuccess = vi.fn();
const toastError = vi.fn();

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return { ...actual, usePageTitle: vi.fn() };
});

vi.mock('@/contexts', async () => {
  const actual = await vi.importActual<typeof import('@/contexts')>('@/contexts');
  return {
    ...actual,
    useTenant: () => ({
      hasModule: vi.fn((_key: string) => true),
      tenantSlug: 'hour-timebank',
      tenantPath: (path: string) => `/hour-timebank${path}`,
      hasFeature: (feature: string) => feature === 'caring_community',
    }),
    useAuth: () => ({
      user: {
        id: 101,
        name: 'Caring Member',
        balance: 8,
      },
    }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
    }),
  };
});

vi.mock('@/components/caring-community/FederationCommunityPicker', () => ({
  FederationCommunityPicker: () => null,
}));

function renderPage(ui: React.ReactElement) {
  return render(
    <>
      <MemoryRouter initialEntries={['/hour-timebank/caring-community']}>{ui}</MemoryRouter>
    </>,
  );
}

describe('Caring Community wallet UI flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a pending hour gift from the inbox endpoint', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/v2/caring-community/hour-gifts/inbox') {
        return Promise.resolve({
          success: true,
          data: {
            items: [
              {
                id: 77,
                hours: 2,
                message: 'For the pharmacy run',
                status: 'pending',
                created_at: '2026-05-01T09:00:00Z',
                partner: { id: 202, name: 'Ada Helper', avatar_url: null },
              },
            ],
          },
        });
      }
      if (url === '/v2/caring-community/hour-gifts/sent') {
        return Promise.resolve({ success: true, data: { items: [] } });
      }
      return Promise.resolve({ success: true, data: null });
    });
    apiMock.post.mockResolvedValue({ success: true, data: { status: 'accepted' } });

    renderPage(<HourGiftPage />);

    fireEvent.click(await screen.findByRole('tab', { name: /inbox/i }));
    expect(await screen.findByText(/From Ada Helper/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/v2/caring-community/hour-gifts/77/accept', {});
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('submits an hour transfer with the destination slug, hours, and reason', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/v2/caring-community/hour-transfer/my-history') {
        return Promise.resolve({ success: true, data: { items: [] } });
      }
      if (url === '/v2/caring-community/federation-directory') {
        return Promise.resolve({ success: true, data: { peers: [] } });
      }
      return Promise.resolve({ success: true, data: null });
    });
    apiMock.post.mockResolvedValue({
      success: true,
      data: { transfer_id: 44, status: 'pending' },
    });

    renderPage(<HourTransferPage />);

    fireEvent.change(await screen.findByLabelText(/Destination cooperative/i), {
      target: { value: 'zug-kiss' },
    });
    fireEvent.change(screen.getByLabelText(/Hours to transfer/i), {
      target: { value: '3.5' },
    });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: 'Moving closer to family' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request Transfer/i }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/v2/caring-community/hour-transfer/initiate', {
        destination_tenant_slug: 'zug-kiss',
        hours: 3.5,
        reason: 'Moving closer to family',
      });
    });
    expect(await screen.findByText(/transfer request submitted/i)).toBeInTheDocument();
  });

  it('renders loyalty redemption history from the member history endpoint', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 9,
            credits_used: 1.5,
            exchange_rate_chf: 25,
            discount_chf: 37.5,
            order_total_chf: 80,
            status: 'applied',
            redeemed_at: '2026-05-02T12:00:00Z',
            merchant_id: 55,
            merchant_name: 'Local Care Market',
            marketplace_listing_id: 88,
            listing_title: 'Meal delivery voucher',
          },
        ],
      },
    });

    renderPage(<LoyaltyHistoryPage />);

    expect(await screen.findByText('Local Care Market')).toBeInTheDocument();
    expect(screen.getByText('Meal delivery voucher')).toBeInTheDocument();
    expect(screen.getByText('CHF 37.50')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/v2/caring-community/loyalty/my-history');
  });
});
