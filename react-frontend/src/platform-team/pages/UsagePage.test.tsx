// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, formattingLocale } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  formattingLocale: vi.fn(() => 'en'),
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
// The page formats with getFormattingLocale() (language + community region).
// Pinned per test to the locale the expected strings are written in.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  getFormattingLocale: formattingLocale,
}));
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

import { UsagePage, formatBytes, formatUsd, type UsageReport } from './UsagePage';

const report = (over: Partial<UsageReport> = {}): UsageReport => ({
  month: '2026-11',
  is_current_month: true,
  sources: { emails: true, ai_chat: true, group_files: true },
  communities: [
    {
      id: 2,
      name: 'Sample Timebank',
      slug: 'sample',
      is_active: true,
      emails: { sent: 1234, failed: 5, bounced: 7 },
      ai_chat: { requests: 40, tokens: 12000, cost_usd: 1.5 },
      group_file_bytes: 3 * 1024 * 1024 * 1024,
    },
    {
      id: 9,
      name: null,
      slug: null,
      is_active: false,
      emails: { sent: 0, failed: 0, bounced: 0 },
      ai_chat: { requests: 0, tokens: 0, cost_usd: 0 },
      group_file_bytes: 0,
    },
  ],
  platform_mail: { sent: 11, failed: 2, bounced: 0 },
  totals: {
    emails: { sent: 1245, failed: 7, bounced: 7 },
    ai_chat: { requests: 40, tokens: 12000, cost_usd: 1.5 },
    group_file_bytes: 3 * 1024 * 1024 * 1024,
  },
  not_recorded: ['maps', 'translation', 'other_storage'],
  ...over,
});

const reply = (data: UsageReport) => ({ success: true, data });

describe('UsagePage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(reply(report()));
  });

  it('asks the platform team request for this month first', async () => {
    render(<UsagePage />);

    await screen.findByTestId('usage-community-2');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/usage');
  });

  it('shows each community’s emails, AI chat and group files in readable units', async () => {
    render(<UsagePage />);

    const card = await screen.findByTestId('usage-community-2');
    expect(within(card).getByText('Sample Timebank')).toBeInTheDocument();
    expect(within(card).getByTestId('usage-2-sent')).toHaveTextContent('1,234');
    expect(within(card).getByTestId('usage-2-failed')).toHaveTextContent('5');
    expect(within(card).getByTestId('usage-2-bounced')).toHaveTextContent('7');
    expect(within(card).getByTestId('usage-2-ai_requests')).toHaveTextContent('40');
    expect(within(card).getByTestId('usage-2-ai_tokens')).toHaveTextContent('12,000');
    expect(within(card).getByTestId('usage-2-ai_cost')).toHaveTextContent('$1.50');
    expect(within(card).getByTestId('usage-2-files')).toHaveTextContent('3 GB');
  });

  it('names a community that no longer exists, and one that is not active', async () => {
    render(<UsagePage />);

    const card = await screen.findByTestId('usage-community-9');
    expect(within(card).getByText('usage.removed_community|9')).toBeInTheDocument();
    expect(within(card).getByText('usage.not_active')).toBeInTheDocument();
  });

  it('shows mail that belongs to no community as its own row', async () => {
    render(<UsagePage />);

    const row = await screen.findByTestId('usage-platform-mail');
    expect(within(row).getByText('usage.platform_mail')).toBeInTheDocument();
    expect(within(row).getByTestId('usage-platform-sent')).toHaveTextContent('11');
    expect(within(row).getByTestId('usage-platform-failed')).toHaveTextContent('2');
  });

  it('lists what is not recorded, in words, never as a zero', async () => {
    render(<UsagePage />);

    const section = await screen.findByTestId('usage-not-recorded');
    expect(within(section).getByText('usage.not_recorded.maps')).toBeInTheDocument();
    expect(within(section).getByText('usage.not_recorded.translation')).toBeInTheDocument();
    expect(within(section).getByText('usage.not_recorded.other_storage')).toBeInTheDocument();
  });

  it('says group files are a total now, not a monthly figure', async () => {
    render(<UsagePage />);

    await screen.findByTestId('usage-community-2');
    expect(screen.getByText('usage.files_note')).toBeInTheDocument();
  });

  it('says "not available" for a part the server could not read, never a zero', async () => {
    apiGet.mockResolvedValue(
      reply(
        report({
          sources: { emails: false, ai_chat: true, group_files: true },
          communities: [
            {
              id: 2,
              name: 'Sample Timebank',
              slug: 'sample',
              is_active: true,
              emails: null,
              ai_chat: { requests: 1, tokens: 2, cost_usd: 0 },
              group_file_bytes: 0,
            },
          ],
          platform_mail: null,
          totals: { emails: null, ai_chat: { requests: 1, tokens: 2, cost_usd: 0 }, group_file_bytes: 0 },
        }),
      ),
    );
    render(<UsagePage />);

    const card = await screen.findByTestId('usage-community-2');
    expect(within(card).getByTestId('usage-2-sent')).toHaveTextContent('usage.not_available');
    expect(within(card).queryByTestId('usage-2-failed')).not.toBeInTheDocument();
    // The section heading is shown once, not again beside "Not available"
    // (a screen reader still hears what the figure is).
    const shown = (scope: HTMLElement, text: string) =>
      within(scope).getAllByText(text).filter((el) => !el.classList.contains('sr-only'));
    expect(shown(card, 'usage.emails_heading')).toHaveLength(1);
    expect(shown(screen.getByTestId('usage-totals'), 'usage.emails_heading')).toHaveLength(1);
    expect(screen.getByText('usage.unavailable.emails')).toBeInTheDocument();
    expect(within(screen.getByTestId('usage-platform-mail')).getByText('usage.not_available')).toBeInTheDocument();
  });

  // Email records are kept 90 days: an older month says why, never zeros.
  it('says email records are kept for 90 days when an older month is chosen', async () => {
    apiGet.mockResolvedValue(
      reply(
        report({
          sources: { emails: false, ai_chat: true, group_files: true },
          source_notes: { emails: 'kept_90_days' },
          communities: [
            {
              id: 2,
              name: 'Sample Timebank',
              slug: 'sample',
              is_active: true,
              emails: null,
              ai_chat: { requests: 1, tokens: 2, cost_usd: 0 },
              group_file_bytes: 0,
            },
          ],
          platform_mail: null,
          totals: { emails: null, ai_chat: { requests: 1, tokens: 2, cost_usd: 0 }, group_file_bytes: 0 },
        }),
      ),
    );
    render(<UsagePage />);

    await screen.findByTestId('usage-community-2');
    expect(screen.getByText('usage.unavailable.emails_kept_90_days')).toBeInTheDocument();
    expect(screen.queryByText('usage.unavailable.emails')).not.toBeInTheDocument();
    expect(screen.getByTestId('usage-2-sent')).toHaveTextContent('usage.not_available');
  });

  it('says bounced emails are included in Sent, and indents its lists from the reading start', async () => {
    render(<UsagePage />);

    await screen.findByTestId('usage-community-2');
    const note = screen.getByText('usage.sent_note');
    expect(note).toBeInTheDocument();
    // Right-to-left languages: the list indent follows the reading direction.
    expect(note.closest('ul')).toHaveClass('ps-5');
    expect(note.closest('ul')).not.toHaveClass('pl-5');
    expect(screen.getByTestId('usage-not-recorded').querySelector('ul')).toHaveClass('ps-5');
  });

  it('moves to the previous month, and cannot move past this month', async () => {
    render(<UsagePage />);
    await screen.findByTestId('usage-community-2');

    expect(screen.getByRole('button', { name: 'usage.next_month' })).toBeDisabled();

    apiGet.mockResolvedValue(reply(report({ month: '2026-10', is_current_month: false })));
    fireEvent.click(screen.getByRole('button', { name: 'usage.previous_month' }));

    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/usage?month=2026-10'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'usage.next_month' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'usage.next_month' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/usage?month=2026-11'));
  });

  it('crosses a year boundary going back', async () => {
    apiGet.mockResolvedValue(reply(report({ month: '2026-01', is_current_month: false })));
    render(<UsagePage />);
    await screen.findByTestId('usage-community-2');

    fireEvent.click(screen.getByRole('button', { name: 'usage.previous_month' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/usage?month=2025-12'));
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<UsagePage />);

    expect(await screen.findByText('usage.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only the month buttons and reload', async () => {
    render(<UsagePage />);
    await screen.findByTestId('usage-community-2');

    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent).sort()).toEqual(
      ['home.refresh', 'usage.next_month', 'usage.previous_month'].sort(),
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  // The server keeps these figures for a short while. The first look uses the
  // kept ones; "Check again" asks for them to be worked out again.
  it('works the figures out again only when "Check again" is pressed, and says when they are from', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...report(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<UsagePage />);

    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/usage');
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/usage?month=2026-11&refresh=1'));
  });

  it('says nothing about when the figures are from when the server does not say', async () => {
    render(<UsagePage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'home.refresh' });
    expect(screen.queryByText(/^shared\.figures_from/)).not.toBeInTheDocument();
  });

  it('keeps the figures on screen and says so when checking again is refused', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...report(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<UsagePage />);
    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();

    apiGet.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many requests' });
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    expect(await screen.findByText('translations.recount_refused')).toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
    expect(screen.getByText(/^shared\.figures_from/)).toBeInTheDocument();
  });
});

describe('formatBytes and formatUsd', () => {
  beforeEach(() => {
    formattingLocale.mockReturnValue('en');
  });

  it('uses readable units in the viewer’s language', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(512 * 1024)).toBe('0.5 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    // German writes a decimal comma and a no-break space before the unit.
    formattingLocale.mockReturnValue('de');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toMatch(/^1,5\sGB$/u);
  });

  it('shows money as US dollars in the viewer’s language, keeping a tiny cost visible', () => {
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0025)).toBe('$0.0025');
    formattingLocale.mockReturnValue('de');
    expect(formatUsd(1.5)).toMatch(/1,50/);
  });
});
