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
// Wording renders as its key, so the tests do not depend on the words chosen.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'time' in options ? `${key}|${String(options.time)}` : key,
    i18n: { language: 'en' },
  }),
}));

import { RecentErrorsPage, type RecentErrorsReport } from './RecentErrorsPage';

const CONNECTED: RecentErrorsReport = {
  connected: true,
  checked_at: '2026-11-16T18:30:00+00:00',
  projects: [
    { key: 'php', available: true, errors_24h: 1234, errors_7d: 5678, unresolved: 9 },
    { key: 'react', available: false, errors_24h: null, errors_7d: null, unresolved: null },
    { key: 'webuk', available: true, errors_24h: 0, errors_7d: 3, unresolved: null },
  ],
};

const reply = (data: RecentErrorsReport) => ({ success: true, data });

describe('RecentErrorsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(reply(CONNECTED));
  });

  it('asks the platform team request and shows one card per part of the platform', async () => {
    render(<RecentErrorsPage />);

    const server = await screen.findByTestId('errors-project-php');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/errors');
    expect(within(server).getByText('errors.project.php')).toBeInTheDocument();
    expect(within(server).getByTestId('errors-php-24h')).toHaveTextContent('1,234');
    expect(within(server).getByTestId('errors-php-7d')).toHaveTextContent('5,678');
    expect(within(server).getByTestId('errors-php-unresolved')).toHaveTextContent('9');
    expect(screen.getByText('errors.project.react')).toBeInTheDocument();
    expect(screen.getByText('errors.project.webuk')).toBeInTheDocument();
  });

  it('shows a zero as a zero, and a figure the service did not give as not available', async () => {
    render(<RecentErrorsPage />);

    const site = await screen.findByTestId('errors-project-webuk');
    expect(within(site).getByTestId('errors-webuk-24h')).toHaveTextContent('0');
    expect(within(site).getByTestId('errors-webuk-unresolved')).toHaveTextContent('errors.not_available');
  });

  it('says a part that could not be read could not be read, never zero', async () => {
    render(<RecentErrorsPage />);

    const website = await screen.findByTestId('errors-project-react');
    expect(within(website).getByText('errors.could_not_read')).toBeInTheDocument();
    expect(within(website).queryByText('0')).not.toBeInTheDocument();
    expect(within(website).queryByTestId('errors-react-24h')).not.toBeInTheDocument();
  });

  it('says when the figures were checked and that the details stay in the error service', async () => {
    render(<RecentErrorsPage />);

    await screen.findByTestId('errors-project-php');
    expect(screen.getByText(/^errors\.checked_at\|.*2026/)).toBeInTheDocument();
    expect(screen.getByText('errors.counts_only')).toBeInTheDocument();
  });

  it('when not connected, explains calmly what would be needed and offers nothing to set up', async () => {
    apiGet.mockResolvedValue(reply({ connected: false, checked_at: null, projects: null }));
    render(<RecentErrorsPage />);

    const box = await screen.findByTestId('errors-not-connected');
    expect(within(box).getByText('errors.not_connected.title')).toBeInTheDocument();
    expect(within(box).getByText('errors.not_connected.needed')).toBeInTheDocument();
    // Which four settings switch it on, the region's address among them.
    expect(within(box).getByText('errors.not_connected.settings')).toBeInTheDocument();
    expect(within(box).getByText('errors.not_connected.decision')).toBeInTheDocument();
    expect(within(box).getByText('errors.not_connected.meanwhile')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
    expect(screen.queryByTestId('errors-project-php')).not.toBeInTheDocument();
  });

  it('asks the error service again only when "check again" is pressed', async () => {
    render(<RecentErrorsPage />);
    await screen.findByTestId('errors-project-php');

    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/errors?refresh=1');
  });

  it('keeps the figures on screen and says so when "check again" is refused', async () => {
    render(<RecentErrorsPage />);
    await screen.findByTestId('errors-project-php');
    apiGet.mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many' });

    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    expect(await screen.findByText('errors.check_refused')).toBeInTheDocument();
    expect(screen.getByTestId('errors-php-24h')).toHaveTextContent('1,234');
    expect(screen.queryByText('errors.load_error_title')).not.toBeInTheDocument();
  });

  it('says the figures could not be read, never an empty grid, when connected but no parts came back', async () => {
    apiGet.mockResolvedValue(reply({ connected: true, checked_at: '2026-11-16T18:30:00+00:00', projects: null }));
    render(<RecentErrorsPage />);

    expect(await screen.findByText('errors.could_not_read_any')).toBeInTheDocument();
    expect(screen.queryByTestId('errors-project-php')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<RecentErrorsPage />);

    expect(await screen.findByText('errors.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only check again', async () => {
    render(<RecentErrorsPage />);
    await screen.findByTestId('errors-project-php');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
