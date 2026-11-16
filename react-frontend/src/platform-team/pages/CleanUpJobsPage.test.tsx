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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { CleanUpJobsPage, type CleanUpJob, type CleanUpJobsReport } from './CleanUpJobsPage';

const job = (over: Partial<CleanUpJob>): CleanUpJob => ({
  key: 'performance_prune',
  how_often: 'daily',
  last_ok_at: null,
  last_failed_at: null,
  status: 'unknown',
  readable: true,
  ...over,
});

const report = (): CleanUpJobsReport => ({
  jobs: [
    job({ key: 'performance_prune', status: 'ok', last_ok_at: '2026-11-16T03:15:04+00:00' }),
    job({ key: 'prune_logs', status: 'late', last_ok_at: '2026-11-12T03:00:02+00:00' }),
    job({
      key: 'abuse_cleanup',
      how_often: 'weekly',
      checked_by: 'finished_only',
      status: 'failing',
      last_ok_at: '2026-11-01T02:00:00+00:00',
      last_failed_at: '2026-11-15T02:00:00+00:00',
    }),
    job({ key: 'cleanup_sessions', how_often: 'hourly', status: 'unknown', checked_by: 'finished_only' }),
    job({ key: 'cleanup', status: 'unknown', readable: false }),
  ],
});

const reply = (data: CleanUpJobsReport) => ({ success: true, data });

describe('CleanUpJobsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(reply(report()));
  });

  it('asks the platform team request and lists every job with its name and what it deletes', async () => {
    render(<CleanUpJobsPage />);

    const rows = await screen.findAllByTestId(/^clean-up-job-[a-z_]+$/);
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/clean-up-jobs');
    expect(rows).toHaveLength(5);
    const first = screen.getByTestId('clean-up-job-performance_prune');
    expect(within(first).getByText('clean_up_jobs.job.performance_prune.name')).toBeInTheDocument();
    expect(within(first).getByText('clean_up_jobs.job.performance_prune.deletes')).toBeInTheDocument();
    expect(within(first).getByText('clean_up_jobs.how_often.daily')).toBeInTheDocument();
  });

  it('says each state in words, and a job with no record is never shown as fine', async () => {
    render(<CleanUpJobsPage />);
    await screen.findByTestId('clean-up-job-performance_prune');

    expect(within(screen.getByTestId('clean-up-job-performance_prune')).getByText('clean_up_jobs.status.ok')).toBeInTheDocument();
    expect(within(screen.getByTestId('clean-up-job-prune_logs')).getByText('clean_up_jobs.status.late')).toBeInTheDocument();
    expect(within(screen.getByTestId('clean-up-job-abuse_cleanup')).getByText('clean_up_jobs.status.failing')).toBeInTheDocument();
    const noRecord = screen.getByTestId('clean-up-job-cleanup_sessions');
    expect(within(noRecord).getByText('clean_up_jobs.status.unknown')).toBeInTheDocument();
    expect(within(noRecord).queryByText('clean_up_jobs.status.ok')).not.toBeInTheDocument();
  });

  it('says a record that could not be read could not be read, not "no record yet"', async () => {
    render(<CleanUpJobsPage />);
    const row = await screen.findByTestId('clean-up-job-cleanup');

    expect(within(row).getAllByText('clean_up_jobs.status.unreadable')).toHaveLength(3);
    expect(within(row).queryByText('clean_up_jobs.status.unknown')).not.toBeInTheDocument();
    expect(within(row).queryByText('clean_up_jobs.never_failed')).not.toBeInTheDocument();
  });

  it('shows when it last ran and when it last failed, and "never" for a failure that never happened', async () => {
    render(<CleanUpJobsPage />);
    await screen.findByTestId('clean-up-job-abuse_cleanup');

    expect(screen.getByTestId('clean-up-job-abuse_cleanup-last-ok')).toHaveTextContent('2026');
    expect(screen.getByTestId('clean-up-job-abuse_cleanup-last-failed')).toHaveTextContent('2026');
    expect(screen.getByTestId('clean-up-job-performance_prune-last-failed')).toHaveTextContent('clean_up_jobs.never_failed');
    expect(screen.getByTestId('clean-up-job-cleanup_sessions-last-ok')).toHaveTextContent('clean_up_jobs.not_recorded');
  });

  it('always says records only start from the day this page went live', async () => {
    render(<CleanUpJobsPage />);
    await screen.findByTestId('clean-up-job-performance_prune');

    expect(screen.getByText('clean_up_jobs.records_note')).toBeInTheDocument();
  });

  // The minute runner's jobs record success even when a step inside failed.
  it('says under a job that records only that it finished that this is all it proves', async () => {
    render(<CleanUpJobsPage />);

    const runner = await screen.findByTestId('clean-up-job-abuse_cleanup');
    expect(within(runner).getByText('clean_up_jobs.finished_only')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('clean-up-job-cleanup_sessions')).getByText('clean_up_jobs.finished_only'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('clean-up-job-performance_prune')).queryByText('clean_up_jobs.finished_only'),
    ).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<CleanUpJobsPage />);

    expect(await screen.findByText('clean_up_jobs.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only reload', async () => {
    render(<CleanUpJobsPage />);
    await screen.findByTestId('clean-up-job-performance_prune');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
  });
});
