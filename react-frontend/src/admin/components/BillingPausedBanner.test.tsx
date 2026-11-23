// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const { apiGet, logError, tenant } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  logError: vi.fn(),
  tenant: { current: { id: 2, name: 'Riverside', slug: 'riverside', billing_paused: true } as Record<string, unknown> },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError }));
vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenant: tenant.current, tenantPath: (path: string) => `/riverside${path}` }),
}));
// A plain anchor: the banner is rendered here without a router.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));
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

  it('links a community that pays the platform by card to its Billing page, where it can check the card and write to the platform team', async () => {
    apiGet.mockResolvedValue(standing({ payee: 'platform', payee_name: null, payer: 'platform_card' }));
    render(<BillingPausedBanner />);

    const link = await screen.findByTestId('billing-paused-link');
    expect(link).toHaveAttribute('href', '/riverside/admin/billing');
    expect(link).toHaveTextContent('paused_banner.open_billing');
  });

  // Owner, 23 Nov 2026: every community's admins have a Billing page, so
  // every paused line has something to click. It was a card payer's alone.
  it.each([
    ['pays by invoice', { payee: 'platform', payee_name: null, payer: 'platform_invoice' }],
    ['pays its parent', { payer: 'parent' }],
    ['is paused from above', { own: false, payee: null, payee_name: null, payer: 'parent' }],
  ])('links a paused community that %s to its Billing page', async (_why, over) => {
    apiGet.mockResolvedValue(standing(over));
    render(<BillingPausedBanner />);

    const link = await screen.findByTestId('billing-paused-link');
    expect(link).toHaveAttribute('href', '/riverside/admin/billing');
    // Not the card payer's wording: there is no card to check.
    expect(link).toHaveTextContent('paused_banner.open_billing_page');
  });

  it('offers a visiting manager no Billing link: that page refuses them', async () => {
    apiGet.mockResolvedValue(standing({ payer: 'platform_card', payee: 'platform', payee_name: null, visiting: true }));
    render(<BillingPausedBanner />);

    await screen.findByRole('alert');
    expect(screen.queryByTestId('billing-paused-link')).not.toBeInTheDocument();
  });

  it('says how to pay, in the payee\'s own words, when the community is paused for its own payment', async () => {
    apiGet.mockResolvedValue(standing({ payer: 'parent', how_to_pay: 'Pay by cheque.\n<b>not markup</b>' }));
    render(<BillingPausedBanner />);

    const note = await screen.findByTestId('billing-banner-how-to-pay');
    expect(note).toHaveTextContent('own_billing.how_to_pay_title');
    expect(note).toHaveTextContent('Pay by cheque.');
    // Text, never markup.
    expect(note).toHaveTextContent('<b>not markup</b>');
    expect(note.querySelector('b')).toBeNull();
  });

  it('shows no note when none is written, or when the pause comes from above', async () => {
    apiGet.mockResolvedValue(standing({ payer: 'parent', how_to_pay: null }));
    const first = render(<BillingPausedBanner />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('billing-banner-how-to-pay')).not.toBeInTheDocument();
    first.unmount();

    apiGet.mockResolvedValue(standing({ own: false, payee: null, payee_name: null, how_to_pay: 'Should not be shown.' }));
    render(<BillingPausedBanner />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('billing-banner-how-to-pay')).not.toBeInTheDocument();
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

  it('gives every warning something to click, and says how to pay a late payment', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ overdue_days: 10, how_to_pay: 'Pay by bank transfer.' }));
    const first = render(<BillingPausedBanner />);

    const link = await screen.findByTestId('billing-warning-link');
    expect(link).toHaveAttribute('href', '/riverside/admin/billing');
    expect(link).toHaveTextContent('paused_banner.open_billing_page');
    expect(screen.getByTestId('billing-banner-how-to-pay')).toHaveTextContent('Pay by bank transfer.');
    first.unmount();

    // A member-limit warning is not about a payment: the link, not the note.
    apiGet.mockResolvedValue(open({ member_limit: { used: 85, max: 100, percent: 85, stage: 'approaching' }, how_to_pay: 'Pay by bank transfer.' }));
    render(<BillingPausedBanner />);
    await screen.findByTestId('billing-warning-link');
    expect(screen.queryByTestId('billing-banner-how-to-pay')).not.toBeInTheDocument();
  });

  it('offers a visiting manager no link on a warning', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ overdue_days: 10, visiting: true }));
    render(<BillingPausedBanner />);

    await screen.findByRole('status');
    expect(screen.queryByTestId('billing-warning-link')).not.toBeInTheDocument();
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

  // What the rule that applies will do, in its own sentence beside the warning.
  const over = (rule: string, acts_on: string | null = null) =>
    ({ used: 120, max: 100, percent: 120, stage: 'over', rule, acts_on });

  it('says nothing extra under the warn-only rule', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: over('none') }));
    render(<BillingPausedBanner />);

    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('paused_banner.limit_over');
    expect(line).not.toHaveTextContent('paused_banner.rule_');
  });

  it('says new members cannot join under the stop-joining rule', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: over('block_joining') }));
    render(<BillingPausedBanner />);

    const rule = await screen.findByText((text) => text.startsWith('paused_banner.rule_block_joining'));
    expect(rule.textContent?.startsWith('paused_banner.rule_block_joining')).toBe(true);
  });

  it('names the pause date under the pause rule', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: over('pause', '2026-12-21') }));
    render(<BillingPausedBanner />);

    const rule = await screen.findByText((text) => text.startsWith('paused_banner.rule_pause_on'));
    expect(rule).toHaveTextContent('"date":"DATE(2026-12-21)"');
  });

  it('says it may be paused when no date is set', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: { ...over('pause'), stage: 'approaching', used: 85, percent: 85 } }));
    render(<BillingPausedBanner />);

    expect(await screen.findByText((text) => text.startsWith('paused_banner.rule_pause_maybe'))).toBeInTheDocument();
  });

  it('says it will be moved up under the move-up rule', async () => {
    notPaused();
    apiGet.mockResolvedValue(open({ plan: null, member_limit: over('upgrade') }));
    render(<BillingPausedBanner />);

    expect(await screen.findByText((text) => text.startsWith('paused_banner.rule_upgrade'))).toBeInTheDocument();
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
