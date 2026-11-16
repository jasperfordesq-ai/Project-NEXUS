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
      if (options && 'names' in options) return `${key}|${String(options.names)}`;
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      return key;
    },
    i18n: {
      language: 'en',
      // The admin panel has a name for these; not for merchant_coupons or ai_agents.
      exists: (key: string) =>
        ['config.module_name_courses', 'config.module_name_caring_community', 'config.module_name_podcasts'].includes(key),
    },
  }),
}));

import { UnfinishedFeaturesPage, type UnfinishedFeatures, type UnfinishedFeatureRow } from './UnfinishedFeaturesPage';

const row = (over: Partial<UnfinishedFeatureRow>): UnfinishedFeatureRow => ({
  key: 'courses',
  stage: 'beta',
  default_on: false,
  note: null,
  communities_on: [
    { id: 2, name: 'Alpha Timebank' },
    { id: 3, name: 'Beta Exchange' },
  ],
  count: 2,
  ...over,
});

const data = (): UnfinishedFeatures => ({
  features: [
    row({ key: 'caring_community', stage: 'alpha', note: 'not_for_use', communities_on: [{ id: 4, name: 'Gamma Circle' }], count: 1 }),
    row({}),
    row({ key: 'podcasts', communities_on: [], count: 0 }),
    row({ key: 'merchant_coupons', stage: null, communities_on: [], count: 0 }),
    row({ key: 'maps', stage: null, communities_on: [{ id: 2, name: 'Alpha Timebank' }], count: 1 }),
  ],
});

const card = (key: string): HTMLElement => screen.getByTestId(`unfinished-feature-${key}`);

describe('UnfinishedFeaturesPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: data() });
  });

  it('asks the platform team request and draws one card per feature', async () => {
    render(<UnfinishedFeaturesPage />);

    await screen.findByTestId('unfinished-features-list');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/unfinished-features');
    expect(within(screen.getByTestId('unfinished-features-list')).getAllByRole('listitem')).toHaveLength(5);
  });

  it('names a feature as the admin Features page does, and shows its key', async () => {
    render(<UnfinishedFeaturesPage />);
    await screen.findByTestId('unfinished-features-list');

    expect(card('courses')).toHaveTextContent('config.module_name_courses');
    expect(card('courses')).toHaveTextContent('courses');
    expect(card('courses')).not.toHaveTextContent('unfinished_features.not_on_admin_page');
  });

  it('shows the key and says so when the admin Features page has no entry for it', async () => {
    render(<UnfinishedFeaturesPage />);
    await screen.findByTestId('unfinished-features-list');

    expect(card('merchant_coupons')).toHaveTextContent('merchant_coupons');
    expect(card('merchant_coupons')).toHaveTextContent('unfinished_features.not_on_admin_page');
    // Maps has a name of its own in the panel, and no card on the admin Features page.
    expect(card('maps')).toHaveTextContent('glance.feature_name.maps');
    expect(card('maps')).toHaveTextContent('unfinished_features.not_on_admin_page');
  });

  it('says the stage in words', async () => {
    render(<UnfinishedFeaturesPage />);
    await screen.findByTestId('unfinished-features-list');

    expect(card('caring_community')).toHaveTextContent('unfinished_features.stage.alpha');
    expect(card('courses')).toHaveTextContent('unfinished_features.stage.beta');
    expect(card('merchant_coupons')).toHaveTextContent('unfinished_features.off_unless_switched_on');
    expect(card('merchant_coupons')).not.toHaveTextContent('unfinished_features.stage.');
  });

  it('marks Caring Community as not for use, with no link', async () => {
    render(<UnfinishedFeaturesPage />);
    await screen.findByTestId('unfinished-features-list');

    expect(card('caring_community')).toHaveTextContent('unfinished_features.note.not_for_use');
    expect(within(card('caring_community')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('names the communities that have a feature on, and says when none has', async () => {
    render(<UnfinishedFeaturesPage />);
    await screen.findByTestId('unfinished-features-list');

    expect(card('courses')).toHaveTextContent('unfinished_features.on_in|2');
    expect(card('courses')).toHaveTextContent(/unfinished_features\.on_names\|Alpha Timebank.+Beta Exchange/);
    expect(card('podcasts')).toHaveTextContent('unfinished_features.on_nowhere');
    expect(card('podcasts')).not.toHaveTextContent('unfinished_features.on_names');
  });

  it('counts the features that are on somewhere', async () => {
    render(<UnfinishedFeaturesPage />);

    expect(await screen.findByText('unfinished_features.summary|5')).toBeInTheDocument();
    expect(screen.getByText('unfinished_features.summary_on_somewhere|3')).toBeInTheDocument();
  });

  it('has no switch and no link: it only shows', async () => {
    render(<UnfinishedFeaturesPage />);
    const list = await screen.findByTestId('unfinished-features-list');

    expect(within(list).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(list).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('unfinished_features.read_only')).toBeInTheDocument();
  });

  it('shows the error card when the reply cannot be loaded, and tries again', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<UnfinishedFeaturesPage />);

    const retry = await screen.findByRole('button', { name: 'couldnt_load_retry' });
    expect(screen.queryByTestId('unfinished-features-list')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('unfinished-features-list')).toBeInTheDocument();
  });

  it('shows the error card for a reply without a list', async () => {
    apiGet.mockResolvedValue({ success: true, data: {} });
    render(<UnfinishedFeaturesPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('unfinished-features-list')).not.toBeInTheDocument();
    expect(screen.getByText('unfinished_features.load_error_title')).toBeInTheDocument();
  });
});
