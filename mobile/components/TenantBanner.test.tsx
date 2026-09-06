// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A community's logo must be readable.
 *
 * This banner forced every logo into a 30 x 30 box with `resizeMode="contain"`. A square
 * emblem is fine in that box; a wide wordmark is not — Hour Timebank's rendered as an
 * unreadable 30dp smear at the top of the feed, which is where the audit found it on the
 * emulator (2026-09-05). The box is now sized from the image's own aspect ratio, capped so a
 * banner-shaped asset cannot push the community's name off the row.
 */

import React from 'react';
import { Image } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

/*
  🔴 `jest-setup.ts` mocks this component away for every other suite (it renders on many
  screens and is noise there). Without this unmock the file under test never runs and every
  assertion here would pass against an empty tree.
*/
jest.unmock('@/components/TenantBanner');

const mockTenant = jest.fn();
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => mockTenant(),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000000',
    textSecondary: '#666666',
    borderSubtle: '#eeeeee',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (key === 'tenant.logoLabel' ? `${String(options?.name)} logo` : key),
  }),
}));

jest.mock('@/lib/utils/resolveImageUrl', () => ({
  resolveImageUrl: (value: string) => `https://cdn.test${value}`,
}));

import TenantBanner from './TenantBanner';

const WIDE_LOGO = { width: 600, height: 100 };
const SQUARE_LOGO = { width: 200, height: 200 };
const TALL_LOGO = { width: 40, height: 400 };

function withLogoSize(size: { width: number; height: number } | 'fail') {
  jest.spyOn(Image, 'getSize').mockImplementation((
    _uri: string,
    onSuccess: (w: number, h: number) => void,
    onError?: (error: unknown) => void,
  ) => {
    if (size === 'fail') onError?.(new Error('unreachable'));
    else onSuccess(size.width, size.height);
  });
}

function tenantWith(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      name: 'Hour Timebank',
      tagline: 'Local development tenant',
      branding: { logo_url: '/logo.png', primary_color: '#006FEE' },
      ...overrides,
    },
  };
}

describe('TenantBanner', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockTenant.mockReturnValue(tenantWith());
  });

  it('gives a wide wordmark the width it needs instead of a 30dp square', async () => {
    withLogoSize(WIDE_LOGO);

    const { getByLabelText } = render(<TenantBanner />);
    const logo = getByLabelText('Hour Timebank logo');

    // 600 x 100 at a 30dp height wants 180dp, which the 120dp cap trims to 120.
    await waitFor(() => expect(logo.props.style).toMatchObject({ width: 120, height: 30 }));
  });

  it('leaves a square emblem square', async () => {
    withLogoSize(SQUARE_LOGO);

    const { getByLabelText } = render(<TenantBanner />);

    await waitFor(() =>
      expect(getByLabelText('Hour Timebank logo').props.style).toMatchObject({ width: 30, height: 30 }));
  });

  it('never draws a tall logo narrower than the row is high', async () => {
    withLogoSize(TALL_LOGO);

    const { getByLabelText } = render(<TenantBanner />);

    // 40 x 400 wants 3dp; the floor keeps it at the row height so it stays visible.
    await waitFor(() =>
      expect(getByLabelText('Hour Timebank logo').props.style).toMatchObject({ width: 30 }));
  });

  it('falls back to the row height when the image cannot be measured', async () => {
    withLogoSize('fail');

    const { getByLabelText } = render(<TenantBanner />);

    await waitFor(() =>
      expect(getByLabelText('Hour Timebank logo').props.style).toMatchObject({ width: 30, height: 30 }));
  });

  it('shows the community initial when it has no logo at all', () => {
    mockTenant.mockReturnValue(tenantWith({ branding: { logo_url: null, primary_color: '#006FEE' } }));

    const { getByText, queryByLabelText } = render(<TenantBanner />);

    expect(getByText('H')).toBeTruthy();
    expect(queryByLabelText('Hour Timebank logo')).toBeNull();
  });

  it('renders the community name and tagline, and drops the tagline when there is none', () => {
    withLogoSize(SQUARE_LOGO);
    const { getByText, queryByText, rerender } = render(<TenantBanner />);

    expect(getByText('Hour Timebank')).toBeTruthy();
    expect(getByText('Local development tenant')).toBeTruthy();

    mockTenant.mockReturnValue(tenantWith({ tagline: null }));
    rerender(<TenantBanner />);

    expect(queryByText('Local development tenant')).toBeNull();
  });

  it('renders nothing at all before a community is chosen', () => {
    mockTenant.mockReturnValue({ tenant: null });

    const { toJSON } = render(<TenantBanner />);

    expect(toJSON()).toBeNull();
  });
});
