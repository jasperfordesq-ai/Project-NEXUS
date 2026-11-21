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
vi.mock('@/lib/helpers', () => ({
  formatDate: (value: string) => `DATE(${value.slice(0, 10)})`,
  getFormattingLocale: () => 'en-GB',
}));
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

  // ── An open community: warnings before anything is paused (Stage 3c) ─────

  const open = (over: Record<string, unknown> = {}) => ({
    success: true,
    data: {
      paused: false, own: null, since: null, payee: null, payee_name: null, payer: 'platform_invoice',
      overdue_days: null, member_limit: null, ...over,
    },
  });

  const notPaused = () => {
    tenant.current = { id: 2, name: 'Riverside', slug: 'riverside', billing_paused: false };
  };

  it('renders nothing for an open community with nothing to say, after asking once', async () => {
    notPaused();
    apiGet.mockResolvedValue(open());
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/v2/admin/billing/standing'));
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('warns an open community that its payment is overdue', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ overdue_days: 10 }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.overdue');
    expect(line).toHaveTextContent('"days":"10"');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['approaching', 'paused_banner.limit_approaching'],
    ['reached', 'paused_banner.limit_reached'],
    ['over', 'paused_banner.limit_over'],
  ])('warns an open community whose member limit is %s', async (stage, key) => {
    notPaused();
    apiGet.mockResolvedValue(open({ member_limit: { used: 85, max: 100, percent: 85, stage } }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent(key);
    expect(line).toHaveTextContent('"used":"85"');
    expect(line).toHaveTextContent('"max":"100"');
  });

  it('says nothing about a member limit below the warning', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ member_limit: { used: 10, max: 100, percent: 10, stage: null } }));
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one line only: an overdue payment before the member limit', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ overdue_days: 3, member_limit: { used: 120, max: 100, percent: 120, stage: 'over' } }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.overdue');
    expect(line).not.toHaveTextContent('limit_over');
  });

  const localPlan = { name: 'Local', max_users: 250, price_monthly: 120, price_yearly: 1200, currency: 'gbp', terms: 'hub' };

  it('names the plan beside a member-limit warning', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: localPlan, member_limit: { used: 212, max: 250, percent: 85, stage: 'approaching' } }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.limit_approaching');
    // Its own element: sentences are never joined with a space (wrong in Japanese).
    const plan = screen.getByText((text) => text.startsWith('paused_banner.limit_plan'));
    expect(plan).toHaveTextContent('"plan":"Local"');
    expect(plan.textContent?.startsWith('paused_banner.limit_plan')).toBe(true);
    expect(screen.getByText((text) => text.startsWith('paused_banner.limit_approaching'))).not.toBe(plan);
  });

  it('adds no banner of its own for a plan when there is nothing to warn about', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: localPlan, member_limit: { used: 10, max: 250, percent: 4, stage: null } }));
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('does not name the plan beside an overdue payment', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: localPlan, overdue_days: 4 }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.overdue');
    expect(line).not.toHaveTextContent('limit_plan');
  });

  it('keeps the member-limit warning as it was when there is no plan', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: { used: 120, max: 100, percent: 120, stage: 'over' } }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.limit_over');
    expect(line).not.toHaveTextContent('limit_plan');
  });

  it('is silent when the request fails for an open community', async () => {
    notPaused();
    apiGet.mockResolvedValue({ success: false, error: 'nope', code: 'HTTP_500' });
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent when the request throws for an open community', async () => {
    notPaused();
    apiGet.mockRejectedValue(new Error('offline'));
    const { container } = render(<BillingPausedBanner />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
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
