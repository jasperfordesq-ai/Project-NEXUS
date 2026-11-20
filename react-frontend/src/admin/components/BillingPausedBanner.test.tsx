// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { apiGet, logError, tenant } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  logError: vi.fn(),
  tenant: { current: { id: 2, name: 'Riverside', slug: 'riverside', billing_paused: true } as Record<string, unknown> },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError }));
vi.mock('@/contexts', () => ({ useTenant: () => ({ tenant: tenant.current }) }));
vi.mock('@/lib/helpers', () => ({ formatDate: (value: string) => `DATE(${value.slice(0, 10)})` }));
// The wording is checked by key and by what is put into it.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}${options ? ` ${JSON.stringify(options)}` : ''}`,
    i18n: { language: 'en' },
  }),
}));

import { BillingPausedBanner } from './BillingPausedBanner';

const standing = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: { paused: true, own: true, since: '2026-11-20 10:00:00', payee: 'parent', payee_name: 'Hour Timebank', ...over },
});

describe('BillingPausedBanner', () => {
  beforeEach(() => {
    apiGet.mockReset();
    logError.mockReset();
    tenant.current = { id: 2, name: 'Riverside', slug: 'riverside', billing_paused: true };
  });

  it('names the parent community when the community pays its parent', async () => {
    apiGet.mockResolvedValue(standing());
    render(<BillingPausedBanner />);

    const banner = await screen.findByRole('alert');
    expect(apiGet).toHaveBeenCalledWith('/v2/admin/billing/standing');
    expect(banner).toHaveTextContent('paused_banner.own_parent');
    expect(banner).toHaveTextContent('"payee":"Hour Timebank"');
    expect(banner).toHaveTextContent('"date":"DATE(2026-11-20)"');
  });

  it('says the platform team when it pays the platform', async () => {
    apiGet.mockResolvedValue(standing({ payee: 'platform', payee_name: null }));
    render(<BillingPausedBanner />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('paused_banner.own_platform');
    expect(banner).not.toHaveTextContent('paused_banner.own_parent');
  });

  it('uses the inherited wording when the lock comes from above', async () => {
    apiGet.mockResolvedValue(standing({ own: false, payee: null, payee_name: null }));
    render(<BillingPausedBanner />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('paused_banner.inherited');
    expect(banner).not.toHaveTextContent('payee');
  });

  it('falls back to the platform wording when a parent has no name to show', async () => {
    apiGet.mockResolvedValue(standing({ payee: 'parent', payee_name: null }));
    render(<BillingPausedBanner />);

    expect(await screen.findByRole('alert')).toHaveTextContent('paused_banner.own_platform');
  });

  it('asks nothing and renders nothing when the community is not paused', () => {
    tenant.current = { id: 2, name: 'Riverside', slug: 'riverside', billing_paused: false };
    const { container } = render(<BillingPausedBanner />);

    expect(apiGet).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the server says it is not paused', async () => {
    apiGet.mockResolvedValue({ success: true, data: { paused: false, own: null, since: null, payee: null, payee_name: null } });
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('still says the community is paused when the reason cannot be loaded', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'nope', code: 'HTTP_500' });
    render(<BillingPausedBanner />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('paused_banner.unknown');
    expect(logError).toHaveBeenCalled();
  });

  it('still says the community is paused when the request throws', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    render(<BillingPausedBanner />);

    expect(await screen.findByRole('alert')).toHaveTextContent('paused_banner.unknown');
    expect(logError).toHaveBeenCalled();
  });
});
