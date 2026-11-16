// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
}));
// Wording renders as its key, so the tests do not depend on the words chosen.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'time' in options ? `${key}|time` : key,
    i18n: { language: 'en', exists: (key: string) => !key.endsWith('.something_new') },
  }),
}));

import { PlatformTeamHome, sameBuild } from './PlatformTeamHome';

const SUMMARY = {
  generated_at: '2026-11-16T02:00:00+00:00',
  overall: 'failing',
  cards: [
    {
      key: 'release',
      status: 'ok',
      facts: [
        { key: 'version', value: '3.2.0', type: 'text' },
        { key: 'commit', value: 'abc123def456', type: 'text' },
        { key: 'deployed_at', value: null, type: 'datetime' },
      ],
    },
    { key: 'database', status: 'ok', facts: [{ key: 'connected', value: true, type: 'bool' }] },
    { key: 'queue', status: 'failing', facts: [{ key: 'lag_seconds', value: 1500, type: 'count' }] },
    { key: 'email', status: 'unknown', facts: [] },
    { key: 'cron', status: 'warning', facts: [{ key: 'failed_24h', value: 3, type: 'count' }] },
    { key: 'disk', status: 'ok', facts: [{ key: 'used_percent', value: 41, type: 'percent' }] },
    { key: 'something_new', status: 'ok', facts: [] },
  ],
};

function renderHome() {
  return render(
    <MemoryRouter>
      <PlatformTeamHome />
    </MemoryRouter>,
  );
}

function card(key: string): HTMLElement {
  return screen.getByTestId(`health-card-${key}`);
}

describe('PlatformTeamHome', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: SUMMARY });
  });

  it('asks the platform team health request and shows a card for each check', async () => {
    renderHome();

    await waitFor(() => expect(card('release')).toBeInTheDocument());
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/health');
    for (const key of ['release', 'database', 'queue', 'email', 'cron', 'disk']) {
      expect(within(card(key)).getByText(`home.card.${key}`)).toBeInTheDocument();
    }
  });

  it('says each card\'s state in words, not only by colour', async () => {
    renderHome();
    await waitFor(() => expect(card('queue')).toBeInTheDocument());

    expect(within(card('database')).getByText('home.status.ok')).toBeInTheDocument();
    expect(within(card('cron')).getByText('home.status.warning')).toBeInTheDocument();
    expect(within(card('queue')).getByText('home.status.failing')).toBeInTheDocument();
  });

  // The rule the page exists for: "could not be read" is never shown as fine.
  it('shows a check that could not be read as exactly that, never as fine', async () => {
    renderHome();
    await waitFor(() => expect(card('email')).toBeInTheDocument());

    expect(within(card('email')).getByText('home.status.unknown')).toBeInTheDocument();
    expect(within(card('email')).queryByText('home.status.ok')).not.toBeInTheDocument();
    expect(within(card('email')).getByText('home.unknown_note')).toBeInTheDocument();
  });

  it('gives the overall verdict and when it was checked', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText('home.overall.failing')).toBeInTheDocument());

    expect(screen.getByText('home.checked_at|time')).toBeInTheDocument();
  });

  it('shows facts in words: yes or no, a number, a percentage, and "not known" for a missing value', async () => {
    renderHome();
    await waitFor(() => expect(card('release')).toBeInTheDocument());

    expect(within(card('database')).getByText('home.value.yes')).toBeInTheDocument();
    expect(within(card('queue')).getByText('1500')).toBeInTheDocument();
    expect(within(card('disk')).getByText('41%')).toBeInTheDocument();
    expect(within(card('release')).getByText('3.2.0')).toBeInTheDocument();
    // deployed_at is null on a development machine.
    expect(within(card('release')).getByText('home.value.not_known')).toBeInTheDocument();
  });

  it('links a card to the page with the detail, inside the panel', async () => {
    renderHome();
    await waitFor(() => expect(card('cron')).toBeInTheDocument());

    expect(within(card('cron')).getByRole('link')).toHaveAttribute('href', '/test/platform-team/cron-jobs');
    expect(within(card('database')).getByRole('link')).toHaveAttribute('href', '/test/platform-team/enterprise/monitoring');
    // No detail page exists for these yet: no link to nowhere.
    expect(within(card('queue')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('still shows a card the page has no wording for, under its own name', async () => {
    renderHome();
    await waitFor(() => expect(card('something_new')).toBeInTheDocument());

    expect(within(card('something_new')).getByText('something_new')).toBeInTheDocument();
  });

  it('checks again when asked', async () => {
    renderHome();
    await waitFor(() => expect(card('release')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('shows the error card, not an empty page, when the request is refused or fails', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    renderHome();

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('health-card-release')).not.toBeInTheDocument();
    expect(screen.queryByText('home.overall.ok')).not.toBeInTheDocument();
  });

  it('shows the error card when the request throws, and can try again', async () => {
    apiGet.mockRejectedValueOnce(new Error('network'));
    renderHome();

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(card('release')).toBeInTheDocument());
  });
});

describe('sameBuild', () => {
  it('compares the browser\'s build with the server\'s, whichever is the longer string', () => {
    expect(sameBuild('abc123def456', 'abc123def4567890')).toBe(true);
    expect(sameBuild('abc123def4567890', 'abc123def456')).toBe(true);
    expect(sameBuild('abc123def456', 'fff000')).toBe(false);
  });

  it('does not guess when either side is unknown', () => {
    expect(sameBuild(null, 'abc123')).toBeNull();
    expect(sameBuild('abc123', '')).toBeNull();
    expect(sameBuild('abc123', 'dev')).toBeNull();
    expect(sameBuild('abc123', 'unknown')).toBeNull();
  });
});
