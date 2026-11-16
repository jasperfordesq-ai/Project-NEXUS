// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({ useToast: () => toast }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}|${String(options.count)}` : key,
    i18n: { language: 'en' },
  }),
}));

import { DomainsPage } from './DomainsPage';

type Status = 'ok' | 'warning' | 'failing' | 'unknown' | 'not_checkable' | null;

function address(over: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'main',
    host: 'example.org',
    uses_platform_address: false,
    status: 'ok' as Status,
    resolves: true,
    certificate_expires_at: '2027-02-14T12:00:00+00:00',
    days_left: 90,
    checked_at: '2026-11-16T05:20:00+00:00',
    error_kind: null as string | null,
    ...over,
  };
}

function community(id: number, addresses: unknown[], name = `Community ${id}`) {
  return { id, name, slug: `c${id}`, is_active: true, addresses };
}

function reply(communities: unknown[], platform: unknown[] = []) {
  return { success: true, data: { platform, communities, warning_days: 21 } };
}

function row(id: number): HTMLElement {
  return screen.getByTestId(`domains-community-${id}`);
}

describe('DomainsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('says what it shows and where the check is made from', async () => {
    apiGet.mockResolvedValue(reply([]));
    render(<DomainsPage />);

    expect(await screen.findByText('domains.intro')).toBeInTheDocument();
    expect(screen.getByText('domains.seen_from_server')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/domains');
  });

  it('puts each state into words', async () => {
    apiGet.mockResolvedValue(reply([
      community(1, [address({ host: 'fine.example.org' })]),
      community(2, [address({ host: 'soon.example.org', status: 'warning', days_left: 5 })]),
      community(3, [address({ host: 'down.example.org', status: 'failing', error_kind: 'does_not_resolve', certificate_expires_at: null, days_left: null, resolves: false })]),
      community(4, [address({ host: 'new.example.org', status: 'unknown', checked_at: null, resolves: null, certificate_expires_at: null, days_left: null })]),
      community(5, [address({ host: 'gone.example.org', status: 'failing', days_left: -2 })]),
      community(6, [address({ host: 'bad value', status: 'not_checkable', checked_at: null, days_left: null, certificate_expires_at: null })]),
      community(7, [address({ host: 'sub.platform.example', status: null, uses_platform_address: true, checked_at: null })]),
      community(8, []),
    ]));
    render(<DomainsPage />);
    await waitFor(() => expect(row(1)).toBeInTheDocument());

    expect(within(row(1)).getByText('domains.status.ok')).toBeInTheDocument();
    expect(within(row(2)).getByText('domains.status.warning|5')).toBeInTheDocument();
    expect(within(row(3)).getByText('domains.reason.does_not_resolve')).toBeInTheDocument();
    expect(within(row(3)).getByText('domains.status.failing')).toBeInTheDocument();
    expect(within(row(4)).getByText('domains.status.unknown')).toBeInTheDocument();
    expect(within(row(5)).getByText('domains.reason.expired')).toBeInTheDocument();
    expect(within(row(6)).getByText('domains.status.not_checkable')).toBeInTheDocument();
    expect(within(row(7)).getByText('domains.uses_platform_address')).toBeInTheDocument();
    expect(within(row(8)).getByText('domains.no_address')).toBeInTheDocument();
  });

  it.each([
    'does_not_resolve',
    'not_a_public_address',
    'no_answer',
    'certificate_not_trusted',
    'could_not_read_certificate',
  ])('gives the reason %s in its own words', async (kind) => {
    apiGet.mockResolvedValue(reply([
      community(1, [address({ status: 'failing', error_kind: kind, certificate_expires_at: null, days_left: null })]),
    ]));
    render(<DomainsPage />);

    expect(await screen.findByText(`domains.reason.${kind}`)).toBeInTheDocument();
  });

  it('lists the platform\'s own addresses in their own section', async () => {
    apiGet.mockResolvedValue(reply([], [
      { host: 'app.platform.example', status: 'ok', resolves: true, certificate_expires_at: '2027-02-14T12:00:00+00:00', days_left: 90, checked_at: '2026-11-16T05:20:00+00:00', error_kind: null },
    ]));
    render(<DomainsPage />);

    const section = await screen.findByTestId('domains-platform');
    expect(within(section).getByText('app.platform.example')).toBeInTheDocument();
    expect(within(section).getByText('domains.status.ok')).toBeInTheDocument();
  });

  it('checks one community now, sending only its id, and shows the answer', async () => {
    apiGet.mockResolvedValue(reply([community(2, [address({ status: 'unknown', checked_at: null })])]));
    apiPost.mockResolvedValue({ success: true, data: community(2, [address({ status: 'warning', days_left: 3 })]) });
    render(<DomainsPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: 'domains.check_now' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/domains/check', { tenant_id: 2 }));
    expect(await within(row(2)).findByText('domains.status.warning|3')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('domains.checked');
  });

  it('does not offer a check for a community with nothing of its own to check', async () => {
    apiGet.mockResolvedValue(reply([
      community(7, [address({ status: null, uses_platform_address: true })]),
      community(8, []),
    ]));
    render(<DomainsPage />);
    await waitFor(() => expect(row(7)).toBeInTheDocument());

    expect(within(row(7)).queryByRole('button', { name: 'domains.check_now' })).toBeNull();
    expect(within(row(8)).queryByRole('button', { name: 'domains.check_now' })).toBeNull();
  });

  it('re-checks the platform\'s own addresses', async () => {
    apiGet.mockResolvedValue(reply([], [{ host: 'app.platform.example', status: 'unknown', resolves: null, certificate_expires_at: null, days_left: null, checked_at: null, error_kind: null }]));
    apiPost.mockResolvedValue({ success: true, data: { platform: [{ host: 'app.platform.example', status: 'ok', resolves: true, certificate_expires_at: '2027-02-14T12:00:00+00:00', days_left: 90, checked_at: '2026-11-16T05:20:00+00:00', error_kind: null }] } });
    render(<DomainsPage />);
    const section = await screen.findByTestId('domains-platform');

    fireEvent.click(within(section).getByRole('button', { name: 'domains.check_now' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/domains/check', { platform: true }));
    expect(await within(section).findByText('domains.status.ok')).toBeInTheDocument();
  });

  it.each([
    ['RATE_LIMIT_EXCEEDED', 'domains.too_many'],
    ['NOT_FOUND', 'domains.check_failed'],
  ])('says why in its own words when the server refuses with %s', async (code, words) => {
    apiGet.mockResolvedValue(reply([community(2, [address()])]));
    apiPost.mockResolvedValue({ success: false, code, error: 'server words' });
    render(<DomainsPage />);
    await waitFor(() => expect(row(2)).toBeInTheDocument());

    fireEvent.click(within(row(2)).getByRole('button', { name: 'domains.check_now' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(words));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText('server words')).toBeNull();
  });

  it('shows the error card, not an empty list, when the list cannot be loaded', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<DomainsPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
  });
});
