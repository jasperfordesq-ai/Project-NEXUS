// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
// The page formats with getFormattingLocale() (language + community region).
// Pin it to the locale these expected strings are written in.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  getFormattingLocale: () => 'en',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { DeploymentsPage, type DeploymentHistory } from './DeploymentsPage';

const history = (over: Partial<DeploymentHistory> = {}): DeploymentHistory => ({
  available: true,
  limit: 30,
  skipped_lines: 0,
  deployments: [
    {
      timestamp: '2026-11-16T14:12:00+00:00',
      subcommand: 'deploy',
      status: 'success',
      commit_short: '7026b13a',
      subject: 'feat: a new page',
      color: 'blue',
      duration_s: 125,
      commit_distance: 4,
    },
    {
      timestamp: '2026-11-15T09:00:00+00:00',
      subcommand: 'rollback',
      status: 'failed',
      commit_short: null,
      subject: null,
      color: null,
      duration_s: null,
      commit_distance: null,
    },
  ],
  ...over,
});

const reply = (data: DeploymentHistory) => ({ success: true, data });

describe('DeploymentsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(reply(history()));
  });

  it('asks the platform team request and lists deployments newest first', async () => {
    render(<DeploymentsPage />);

    const rows = await screen.findAllByTestId(/^deployment-\d+$/);
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/deployments');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('7026b13a')).toBeInTheDocument();
  });

  it('shows the kind, the outcome in words, the version, the change, the time taken and the number of changes', async () => {
    render(<DeploymentsPage />);

    const first = await screen.findByTestId('deployment-0');
    expect(within(first).getByText('deployments.kind.deploy')).toBeInTheDocument();
    expect(within(first).getByText('deployments.outcome.success')).toBeInTheDocument();
    expect(within(first).getByText('feat: a new page')).toBeInTheDocument();
    expect(within(first).getByTestId('deployment-0-duration')).toHaveTextContent('2 min 5 sec');
    expect(within(first).getByTestId('deployment-0-changes')).toHaveTextContent('4');
    expect(within(first).getByTestId('deployment-0-when')).toHaveTextContent('2026');

    const second = screen.getByTestId('deployment-1');
    expect(within(second).getByText('deployments.kind.rollback')).toBeInTheDocument();
    expect(within(second).getByText('deployments.outcome.failed')).toBeInTheDocument();
    expect(within(second).getAllByText('deployments.not_recorded').length).toBeGreaterThan(0);
  });

  it('always says the 30-minute watch after a deployment is not recorded here', async () => {
    render(<DeploymentsPage />);

    await screen.findByTestId('deployment-0');
    expect(screen.getByText('deployments.watch_note')).toBeInTheDocument();
  });

  it('says how many lines could not be read', async () => {
    apiGet.mockResolvedValue(reply(history({ skipped_lines: 2 })));
    render(<DeploymentsPage />);

    expect(await screen.findByText('deployments.skipped|2')).toBeInTheDocument();
  });

  it('says this server keeps no record when the file is missing, never "no deployments"', async () => {
    apiGet.mockResolvedValue(reply({ available: false, deployments: null, skipped_lines: null, limit: 30 }));
    render(<DeploymentsPage />);

    expect(await screen.findByText('deployments.no_record_title')).toBeInTheDocument();
    expect(screen.getByText('deployments.no_record_text')).toBeInTheDocument();
    expect(screen.queryByText('deployments.empty')).not.toBeInTheDocument();
    expect(screen.getByText('deployments.watch_note')).toBeInTheDocument();
  });

  it('says nothing has been recorded yet for an empty record', async () => {
    apiGet.mockResolvedValue(reply(history({ deployments: [] })));
    render(<DeploymentsPage />);

    expect(await screen.findByText('deployments.empty')).toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<DeploymentsPage />);

    expect(await screen.findByText('deployments.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only reload', async () => {
    render(<DeploymentsPage />);
    await screen.findByTestId('deployment-0');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
  });
});
