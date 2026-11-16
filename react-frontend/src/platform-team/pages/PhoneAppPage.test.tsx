// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  // The values a key is given are shown after it, so a test can see them.
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && ('version' in opts || 'count' in opts) ? `${key}:${String(opts.version ?? opts.count)}` : key,
    i18n: { language: 'en' },
  }),
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

  it('lists the app versions in use, newest first as the server sends them, and the sign-ins with none', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: {
        ...STATS,
        versions: [
          { version: '1.13.0', sign_ins: 4 },
          { version: '1.12.0', sign_ins: 1 },
        ],
        version_not_recorded: 7,
      },
    });
    render(<PhoneAppPage />);

    const section = await screen.findByRole('region', { name: 'phone_app.versions.title' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('phone_app.versions.version:1.13.0');
    expect(rows[0]).toHaveTextContent('phone_app.versions.sign_ins:4');
    expect(rows[1]).toHaveTextContent('phone_app.versions.version:1.12.0');
    expect(within(section).getByText('phone_app.versions.not_recorded:7')).toBeInTheDocument();
    // Honest about what the figures cover.
    expect(within(section).getByText('phone_app.versions.coverage')).toBeInTheDocument();
    expect(screen.getByTestId('all-communities')).toBeInTheDocument();
  });

  it('says no version is recorded yet when none is, and still gives the count without one', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...STATS, versions: [], version_not_recorded: 12 } });
    render(<PhoneAppPage />);

    const section = await screen.findByRole('region', { name: 'phone_app.versions.title' });
    expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(section).getByText('phone_app.versions.none_yet')).toBeInTheDocument();
    expect(within(section).getByText('phone_app.versions.not_recorded:12')).toBeInTheDocument();
  });

  it('shows no versions section, and no error, when an older server does not send one', async () => {
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('all-communities')).toBeInTheDocument();
    expect(screen.queryByText('phone_app.versions.title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
  });

  // The server sends null when the versions could not be read: hide them, never "none yet".
  it('shows no versions section, and no error, when the server could not read them', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...STATS, versions: null, version_not_recorded: null } });
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('all-communities')).toBeInTheDocument();
    expect(screen.queryByText('phone_app.versions.title')).not.toBeInTheDocument();
    expect(screen.queryByText('phone_app.versions.none_yet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
  });

  it('shows the error card when the request throws, and can try again', async () => {
    apiGet.mockRejectedValueOnce(new Error('network'));
    render(<PhoneAppPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(screen.getByTestId('all-communities')).toBeInTheDocument());
  });
});
