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
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'done' in options) return `${key}|${String(options.done)}/${String(options.total)}`;
      if (options && 'shown' in options) return `${key}|${String(options.shown)}/${String(options.total)}`;
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'date' in options) return `${key}|${String(options.date)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { CommunitySetupPage, type CommunitySetup, type CommunitySetupRow } from './CommunitySetupPage';

const row = (over: Partial<CommunitySetupRow>): CommunitySetupRow => ({
  id: 2,
  name: 'Alpha Timebank',
  slug: 'alpha',
  is_active: true,
  created_at: '2026-11-01T10:00:00+00:00',
  make_it_yours: { done: 6, total: 6 },
  own_address: true,
  accessible_address: true,
  privacy_notice_published: true,
  terms_published: true,
  first_admin_signed_in: true,
  email_sender: 'own',
  ...over,
});

const setup = (over: Partial<CommunitySetup> = {}): CommunitySetup => ({
  max_communities: 200,
  total_communities: 2,
  truncated: false,
  unavailable: [],
  communities: [
    row({}),
    row({
      id: 3, name: 'Beta Exchange', slug: 'beta', is_active: false, make_it_yours: { done: 2, total: 6 },
      own_address: false, accessible_address: false, privacy_notice_published: false, terms_published: true,
      first_admin_signed_in: false, email_sender: 'platform',
    }),
  ],
  ...over,
});

const tableRow = (name: string): HTMLElement =>
  within(screen.getByTestId('community-setup-table')).getByRole('row', { name: new RegExp(`^${name}`) });

describe('CommunitySetupPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: setup() });
  });

  it('asks the platform team request and draws a row per community', async () => {
    render(<CommunitySetupPage />);

    await screen.findByTestId('community-setup-table');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/community-setup');
    expect(tableRow('Alpha Timebank')).toBeInTheDocument();
    expect(tableRow('Beta Exchange')).toBeInTheDocument();
  });

  it('says done and not done in words, not only with a colour', async () => {
    render(<CommunitySetupPage />);
    await screen.findByTestId('community-setup-table');

    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    const beta = within(tableRow('Beta Exchange')).getAllByRole('cell');
    // Make it yours, own address, accessible address, privacy, terms, first admin, email sender.
    expect(alpha[0]).toHaveTextContent('community_setup.make_it_yours_count|6/6');
    expect(beta[0]).toHaveTextContent('community_setup.make_it_yours_count|2/6');
    expect(alpha[1]).toHaveTextContent('community_setup.done');
    expect(beta[1]).toHaveTextContent('community_setup.not_done');
    expect(beta[3]).toHaveTextContent('community_setup.not_done');
    expect(beta[4]).toHaveTextContent('community_setup.done');
    expect(beta[5]).toHaveTextContent('community_setup.not_done');
  });

  it('says which email sender a community uses', async () => {
    render(<CommunitySetupPage />);
    await screen.findByTestId('community-setup-table');

    expect(within(tableRow('Alpha Timebank')).getAllByRole('cell')[6]).toHaveTextContent('community_setup.sender_own');
    expect(within(tableRow('Beta Exchange')).getAllByRole('cell')[6]).toHaveTextContent('community_setup.sender_platform');
  });

  it('explains that terms are added automatically, and that email sending is not checked', async () => {
    render(<CommunitySetupPage />);
    await screen.findByTestId('community-setup-table');

    expect(screen.getByText('community_setup.terms_note')).toBeInTheDocument();
    expect(screen.getByText('community_setup.not_recorded')).toBeInTheDocument();
  });

  it('marks a community that is switched off', async () => {
    render(<CommunitySetupPage />);
    await screen.findByTestId('community-setup-table');

    expect(tableRow('Beta Exchange')).toHaveTextContent('community_setup.not_active');
    expect(tableRow('Alpha Timebank')).not.toHaveTextContent('community_setup.not_active');
  });

  it('shows a step that could not be read as not available, never as not done', async () => {
    const data = setup({ unavailable: ['legal_documents', 'make_it_yours'] });
    data.communities = data.communities.map((c) => ({
      ...c, privacy_notice_published: null, terms_published: null, make_it_yours: null,
    }));
    apiGet.mockResolvedValue({ success: true, data });
    render(<CommunitySetupPage />);

    expect(await screen.findByText('community_setup.unavailable_note')).toBeInTheDocument();
    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    expect(alpha[0]).toHaveTextContent('community_setup.not_available');
    expect(alpha[3]).toHaveTextContent('community_setup.not_available');
    expect(alpha[3]).not.toHaveTextContent('community_setup.not_done');
  });

  it('says when the list stops at the cap', async () => {
    apiGet.mockResolvedValue({ success: true, data: setup({ truncated: true, total_communities: 250 }) });
    render(<CommunitySetupPage />);

    expect(await screen.findByText('community_setup.truncated|2/250')).toBeInTheDocument();
  });

  it('does not talk about a cap when every community is shown', async () => {
    render(<CommunitySetupPage />);
    await screen.findByTestId('community-setup-table');

    expect(screen.queryByText(/community_setup\.truncated/)).not.toBeInTheDocument();
    expect(screen.getByText('community_setup.community_count|2')).toBeInTheDocument();
  });

  it('gives a narrow screen one card per community', async () => {
    render(<CommunitySetupPage />);

    const list = await screen.findByTestId('community-setup-list');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent('Beta Exchange');
    expect(cards[1]).toHaveTextContent('community_setup.not_done');
    expect(cards[1]).toHaveTextContent('community_setup.sender_platform');
  });

  it('says there are no communities rather than drawing an empty table', async () => {
    apiGet.mockResolvedValue({ success: true, data: setup({ communities: [], total_communities: 0 }) });
    render(<CommunitySetupPage />);

    expect(await screen.findByText('community_setup.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('community-setup-table')).not.toBeInTheDocument();
  });

  it('shows the error card when the reply cannot be loaded, and tries again', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<CommunitySetupPage />);

    const retry = await screen.findByRole('button', { name: 'couldnt_load_retry' });
    expect(screen.queryByTestId('community-setup-table')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('community-setup-table')).toBeInTheDocument();
  });

  it('shows the error card for a reply without a list', async () => {
    apiGet.mockResolvedValue({ success: true, data: { truncated: false } });
    render(<CommunitySetupPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('community-setup-table')).not.toBeInTheDocument();
    expect(screen.getByText('community_setup.load_error_title')).toBeInTheDocument();
  });
});
