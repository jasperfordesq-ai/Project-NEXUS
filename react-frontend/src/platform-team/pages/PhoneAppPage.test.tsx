// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// The block itself has its own life in the admin module; here only that it is
// given the server's figures.
vi.mock('@/admin/modules/system/PhoneAppAllCommunities', () => ({
  PhoneAppAllCommunities: ({ platform }: { platform: { members_with_app: number; by_tenant: unknown[] } }) => (
    <div data-testid="all-communities">
      {platform.members_with_app}:{platform.by_tenant.length}
    </div>
  ),
}));

import { PhoneAppPage } from './PhoneAppPage';

const STATS = {
  members_with_app: 57,
  native_devices: 51,
  devices_by_platform: { android: 40, ios: 11 },
  tenants_with_app: 2,
  by_tenant: [{ tenant_id: 2 }, { tenant_id: 3 }],
  recent_members: [],
};

describe('PhoneAppPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: STATS });
  });

  it('asks the platform team request and shows the all-communities figures', async () => {
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('all-communities')).toHaveTextContent('57:2');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/phone-app');
  });

  it('says these are members signed in on the app, not store downloads', async () => {
    render(<PhoneAppPage />);

    expect(await screen.findByText('phone_app.not_downloads')).toBeInTheDocument();
  });

  it('shows the error card, not a platform of zero, when the server refuses', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('all-communities')).not.toBeInTheDocument();
  });

  it('shows the error card when the request throws, and can try again', async () => {
    apiGet.mockRejectedValueOnce(new Error('network'));
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(screen.getByTestId('all-communities')).toBeInTheDocument());
  });
});
