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
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'id' in options) return `${key}|${String(options.id)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { PushNotificationsPage, type PushReport } from './PushNotificationsPage';

const report = (over: Partial<PushReport> = {}): PushReport => ({
  available: true,
  days: 14,
  by_day: [
    { date: '2026-11-15', accepted: 1200, partial: 3, failed: 4, nobody_to_send_to: 50 },
    { date: '2026-11-16', accepted: 0, partial: 0, failed: 0, nobody_to_send_to: 0 },
  ],
  by_community: [
    { id: 2, name: 'Sample Timebank', accepted: 900, partial: 2, failed: 1 },
    { id: 9, name: null, accepted: 0, partial: 0, failed: 3 },
  ],
  no_community: { accepted: 300, partial: 1, failed: 0 },
  ...over,
});

const reply = (data: PushReport) => ({ success: true, data });

describe('PushNotificationsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(reply(report()));
  });

  it('asks the platform team request for 14 days first', async () => {
    render(<PushNotificationsPage />);

    await screen.findByTestId('push-day-2026-11-15');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/push-notifications?days=14');
  });

  it('says what the figures are not, and that days run in server time', async () => {
    render(<PushNotificationsPage />);

    await screen.findByTestId('push-day-2026-11-15');
    expect(screen.getByText('push_notifications.intro')).toBeInTheDocument();
    expect(screen.getByText('push_notifications.timezone_note')).toBeInTheDocument();
  });

  it('says how long the record is kept, with the number the server sends', async () => {
    apiGet.mockResolvedValue(reply(report({ kept_days: 180 })));
    render(<PushNotificationsPage />);

    expect(await screen.findByText('push_notifications.kept_note|180')).toBeInTheDocument();
  });

  it('says nothing about keeping when an older server does not send the number', async () => {
    render(<PushNotificationsPage />);

    await screen.findByTestId('push-day-2026-11-15');
    expect(screen.queryByText(/push_notifications\.kept_note/)).not.toBeInTheDocument();
  });

  it('shows the four figures for each day, a quiet day included', async () => {
    render(<PushNotificationsPage />);

    const day = await screen.findByTestId('push-day-2026-11-15');
    expect(within(day).getByTestId('push-day-2026-11-15-accepted')).toHaveTextContent('1,200');
    expect(within(day).getByTestId('push-day-2026-11-15-partial')).toHaveTextContent('3');
    expect(within(day).getByTestId('push-day-2026-11-15-failed')).toHaveTextContent('4');
    expect(within(day).getByTestId('push-day-2026-11-15-nobody_to_send_to')).toHaveTextContent('50');

    const quiet = screen.getByTestId('push-day-2026-11-16');
    expect(within(quiet).getByTestId('push-day-2026-11-16-accepted')).toHaveTextContent('0');
  });

  it('shows each community, one that no longer exists, and pushes with no community', async () => {
    render(<PushNotificationsPage />);

    const card = await screen.findByTestId('push-community-2');
    expect(within(card).getByText('Sample Timebank')).toBeInTheDocument();
    expect(within(card).getByTestId('push-community-2-accepted')).toHaveTextContent('900');
    expect(within(card).getByTestId('push-community-2-failed')).toHaveTextContent('1');

    expect(within(screen.getByTestId('push-community-9')).getByText('push_notifications.removed_community|9')).toBeInTheDocument();
    expect(within(screen.getByTestId('push-no-community')).getByTestId('push-no-community-accepted')).toHaveTextContent('300');
  });

  it('changes the number of days with a simple choice of 7, 14 or 30', async () => {
    render(<PushNotificationsPage />);
    await screen.findByTestId('push-day-2026-11-15');

    expect(screen.getByRole('button', { name: 'push_notifications.days_option|14' })).toHaveAttribute('aria-pressed', 'true');

    apiGet.mockResolvedValue(reply(report({ days: 30 })));
    fireEvent.click(screen.getByRole('button', { name: 'push_notifications.days_option|30' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/push-notifications?days=30'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'push_notifications.days_option|30' })).toHaveAttribute('aria-pressed', 'true'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'push_notifications.days_option|7' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/push-notifications?days=7'));
  });

  it('says "not available" when the record could not be read, never zeros', async () => {
    apiGet.mockResolvedValue(
      reply({ available: false, days: 14, by_day: null, by_community: null, no_community: null }),
    );
    render(<PushNotificationsPage />);

    expect(await screen.findByText('push_notifications.not_available')).toBeInTheDocument();
    expect(screen.queryByTestId('push-day-2026-11-15')).not.toBeInTheDocument();
    expect(screen.queryByTestId('push-no-community')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<PushNotificationsPage />);

    expect(await screen.findByText('push_notifications.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only the day choice and reload', async () => {
    render(<PushNotificationsPage />);
    await screen.findByTestId('push-day-2026-11-15');

    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent).sort()).toEqual(
      [
        'home.refresh',
        'push_notifications.days_option|7',
        'push_notifications.days_option|14',
        'push_notifications.days_option|30',
      ].sort(),
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  // The server keeps these figures for a short while. The first look uses the
  // kept ones; "Check again" asks for them to be worked out again.
  it('works the figures out again only when "Check again" is pressed, and says when they are from', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...report(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<PushNotificationsPage />);

    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/push-notifications?days=14');
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/push-notifications?days=14&refresh=1'));
  });

  it('says nothing about when the figures are from when the server does not say', async () => {
    render(<PushNotificationsPage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'home.refresh' });
    expect(screen.queryByText(/^shared\.figures_from/)).not.toBeInTheDocument();
  });

  it('keeps the figures on screen and says so when checking again is refused', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...report(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<PushNotificationsPage />);
    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();

    apiGet.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many requests' });
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    expect(await screen.findByText('translations.recount_refused')).toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
    expect(screen.getByText(/^shared\.figures_from/)).toBeInTheDocument();
  });
});
