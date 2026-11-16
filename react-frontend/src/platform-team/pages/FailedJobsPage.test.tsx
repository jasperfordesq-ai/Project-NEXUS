// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, apiDelete, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost, delete: apiDelete } }));
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
// The shared confirm dialog, reduced to what the page uses.
vi.mock('@/admin/components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>confirm</button>
        <button onClick={onClose}>cancel</button>
      </div>
    ) : null,
}));

import { FailedJobsPage } from './FailedJobsPage';

const JOBS = [
  { id: 'uuid-1', job: 'SendWelcomeEmail', queue: 'default', failed_at: '2026-11-16T01:00:00+00:00', reason: 'RuntimeException: Mailbox [email] rejected the message' },
  { id: 'uuid-2', job: null, queue: 'federation', failed_at: null, reason: null },
];

function listReply(jobs = JOBS, total = jobs.length) {
  return { success: true, data: { jobs, total, page: 1, per_page: 25 } };
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`failed-job-${id}`);
}

describe('FailedJobsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    apiGet.mockResolvedValue(listReply());
    apiPost.mockResolvedValue({ success: true, data: { retried: true } });
    apiDelete.mockResolvedValue({ success: true, data: { discarded: true } });
  });

  it('lists each failed job with its name, queue and one line of the reason', async () => {
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/failed-jobs?page=1&per_page=25');
    expect(within(row('uuid-1')).getByText('SendWelcomeEmail')).toBeInTheDocument();
    expect(within(row('uuid-1')).getByText('default')).toBeInTheDocument();
    expect(within(row('uuid-1')).getByText('RuntimeException: Mailbox [email] rejected the message')).toBeInTheDocument();
    expect(screen.getByText('failed_jobs.count|2')).toBeInTheDocument();
  });

  it('says so when a job has no readable name or reason, instead of leaving a gap', async () => {
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-2')).toBeInTheDocument());

    expect(within(row('uuid-2')).getByText('failed_jobs.unknown_job')).toBeInTheDocument();
    expect(within(row('uuid-2')).getByText('failed_jobs.no_reason')).toBeInTheDocument();
  });

  it('says there is nothing waiting when the list is empty', async () => {
    apiGet.mockResolvedValue(listReply([], 0));
    render(<FailedJobsPage />);

    expect(await screen.findByText('failed_jobs.empty_title')).toBeInTheDocument();
  });

  it('runs a job again, says so, and reloads the list', async () => {
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    fireEvent.click(within(row('uuid-1')).getByRole('button', { name: 'failed_jobs.retry' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/failed-jobs/uuid-1/retry'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('failed_jobs.retried'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('asks before discarding, and discards only after a yes', async () => {
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    fireEvent.click(within(row('uuid-1')).getByRole('button', { name: 'failed_jobs.discard' }));
    expect(apiDelete).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole('dialog')).getByText('confirm'));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/v2/platform-team/failed-jobs/uuid-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('failed_jobs.discarded'));
  });

  it('does not discard when the question is cancelled', async () => {
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    fireEvent.click(within(row('uuid-1')).getByRole('button', { name: 'failed_jobs.discard' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));

    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says it did not work when the server refuses, and does not claim success', async () => {
    apiPost.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    fireEvent.click(within(row('uuid-1')).getByRole('button', { name: 'failed_jobs.retry' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('failed_jobs.action_failed'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows the error card, not "nothing waiting", when the list cannot be loaded', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<FailedJobsPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('failed_jobs.empty_title')).not.toBeInTheDocument();
  });

  it('offers the next page when there are more than fit on one', async () => {
    apiGet.mockResolvedValue(listReply(JOBS, 60));
    render(<FailedJobsPage />);
    await waitFor(() => expect(row('uuid-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'failed_jobs.next_page' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/failed-jobs?page=2&per_page=25'));
  });
});
