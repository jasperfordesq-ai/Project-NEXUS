// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, logError } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), logError: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost } }));
vi.mock('@/lib/logger', () => ({ logError }));
// The band asks again when the admin moves to another page; the tests move
// the page by changing this and re-rendering.
const route = vi.hoisted(() => ({ pathname: '/riverside/admin' }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: route.pathname }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { PlatformNoticeBand } from './PlatformNoticeBand';
import { httpsLink } from '@/lib/platformNotice';

const notice = (over: Record<string, unknown> = {}) => ({
  id: 7,
  message: 'Planned work on Tuesday evening.',
  kind: 'planned_work',
  link_url: null,
  link_label: null,
  is_dismissible: true,
  ...over,
});

const reply = (notices: unknown[]) => ({ success: true, data: { notices } });

describe('PlatformNoticeBand', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    logError.mockReset();
    apiPost.mockResolvedValue({ success: true, data: { ok: true } });
  });

  it('asks the admin request and shows each notice with its kind in words', async () => {
    apiGet.mockResolvedValue(reply([notice(), notice({ id: 8, kind: 'important', message: 'Please read.' })]));
    render(<PlatformNoticeBand />);

    const first = await screen.findByTestId('platform-notice-7');
    expect(apiGet).toHaveBeenCalledWith('/v2/admin/platform-notices');
    expect(within(first).getByText('Planned work on Tuesday evening.')).toBeInTheDocument();
    expect(within(first).getByText('platform_notice.kind.planned_work')).toBeInTheDocument();
    expect(within(screen.getByTestId('platform-notice-8')).getByText('platform_notice.kind.important')).toBeInTheDocument();
  });

  it('takes up no room when there is nothing to show', async () => {
    apiGet.mockResolvedValue(reply([]));
    const { container } = render(<PlatformNoticeBand />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  // Review finding, 16 Nov 2026: the API client answers `{ success: false }`
  // for a 403 or a 500; it does not throw. The first version logged only a
  // thrown error, so a refused or broken request looked exactly like "no
  // notice" and left no trace.
  it.each([
    ['the request is refused or the server errors', () => apiGet.mockResolvedValue({ success: false, error: 'Server error', code: 'SERVER_ERROR' })],
    ['the network fails', () => apiGet.mockRejectedValue(new Error('network'))],
    ['the reply is not the shape expected', () => apiGet.mockResolvedValue({ success: true, data: [] })],
  ])('says the notices could not be loaded, and records why, when %s', async (_why, arrange) => {
    arrange();
    render(<PlatformNoticeBand />);

    expect(await screen.findByText('platform_notice.load_failed')).toBeInTheDocument();
    expect(logError).toHaveBeenCalled();
    // It is one quiet line, not an alarm on every admin page.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('records it when closing a notice was not saved', async () => {
    apiGet.mockResolvedValue(reply([notice()]));
    apiPost.mockResolvedValue({ success: false, error: 'Server error' });
    render(<PlatformNoticeBand />);

    fireEvent.click(await screen.findByRole('button', { name: 'platform_notice.close' }));

    await waitFor(() => expect(logError).toHaveBeenCalled());
  });

  it('shows the words as plain text, never as markup', async () => {
    apiGet.mockResolvedValue(reply([notice({ message: 'Hello <b>admins</b>' })]));
    render(<PlatformNoticeBand />);

    const band = await screen.findByTestId('platform-notice-7');
    expect(within(band).getByText('Hello <b>admins</b>')).toBeInTheDocument();
    expect(band.querySelector('b')).toBeNull();
  });

  it('opens a link in a new tab without handing the page over', async () => {
    apiGet.mockResolvedValue(reply([notice({ link_url: 'https://example.test/changelog', link_label: 'What changed' })]));
    render(<PlatformNoticeBand />);

    const link = await screen.findByRole('link', { name: /What changed/ });
    expect(link).toHaveAttribute('href', 'https://example.test/changelog');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    ['http://example.test/'],
    ['javascript:alert(1)'],
    ['/admin'],
    ['https://trusted.example@evil.example/'],
  ])('never draws a link for %s, even if the server sent it', async (url) => {
    apiGet.mockResolvedValue(reply([notice({ link_url: url, link_label: 'Go' })]));
    render(<PlatformNoticeBand />);

    await screen.findByTestId('platform-notice-7');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('closes a notice for this person and tells the server', async () => {
    apiGet.mockResolvedValue(reply([notice()]));
    render(<PlatformNoticeBand />);

    fireEvent.click(await screen.findByRole('button', { name: 'platform_notice.close' }));

    await waitFor(() => expect(screen.queryByTestId('platform-notice-7')).not.toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledWith('/v2/admin/platform-notices/7/dismiss');
  });

  it('has no close button on a notice that may not be closed', async () => {
    apiGet.mockResolvedValue(reply([notice({ is_dismissible: false })]));
    render(<PlatformNoticeBand />);

    await screen.findByTestId('platform-notice-7');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Owner, 16 Nov 2026: an ended notice must not stay on an admin's screen
  // until they happen to reload the page.
  describe('keeping up to date without a reload', () => {
    const START = 1_800_000_000_000;
    let now = START;

    beforeEach(() => {
      now = START;
      route.pathname = '/riverside/admin';
      vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const moveTo = (pathname: string, rerender: (ui: React.ReactElement) => void) => {
      route.pathname = pathname;
      rerender(<PlatformNoticeBand />);
    };

    it('asks again when the admin moves to another page, and an ended notice leaves the screen', async () => {
      apiGet.mockResolvedValueOnce(reply([notice()]));
      const { rerender } = render(<PlatformNoticeBand />);
      await screen.findByTestId('platform-notice-7');

      // The platform team has ended it since.
      apiGet.mockResolvedValue(reply([]));
      now = START + 61_000;
      moveTo('/riverside/admin/users', rerender);

      await waitFor(() => expect(screen.queryByTestId('platform-notice-7')).not.toBeInTheDocument());
      expect(apiGet).toHaveBeenCalledTimes(2);
    });

    it('does not ask on every page: at most once a minute', async () => {
      apiGet.mockResolvedValue(reply([notice()]));
      const { rerender } = render(<PlatformNoticeBand />);
      await screen.findByTestId('platform-notice-7');

      now = START + 10_000;
      moveTo('/riverside/admin/users', rerender);
      now = START + 30_000;
      moveTo('/riverside/admin/listings', rerender);

      expect(apiGet).toHaveBeenCalledTimes(1);
    });

    it('asks again when the admin comes back to the tab after a while', async () => {
      apiGet.mockResolvedValueOnce(reply([notice()]));
      render(<PlatformNoticeBand />);
      await screen.findByTestId('platform-notice-7');

      apiGet.mockResolvedValue(reply([]));
      now = START + 5 * 60_000;
      document.dispatchEvent(new Event('visibilitychange'));

      await waitFor(() => expect(screen.queryByTestId('platform-notice-7')).not.toBeInTheDocument());
    });

    it('keeps what it is showing when asking again fails', async () => {
      apiGet.mockResolvedValueOnce(reply([notice()]));
      const { rerender } = render(<PlatformNoticeBand />);
      await screen.findByTestId('platform-notice-7');

      apiGet.mockResolvedValue({ success: false, error: 'Server error' });
      now = START + 61_000;
      moveTo('/riverside/admin/users', rerender);

      await waitFor(() => expect(logError).toHaveBeenCalled());
      expect(screen.getByTestId('platform-notice-7')).toBeInTheDocument();
      expect(screen.queryByText('platform_notice.load_failed')).not.toBeInTheDocument();
    });

    it('does not bring back a notice closed on this page if the server has not caught up yet', async () => {
      // The server keeps sending it: the "closed" request has not landed.
      apiGet.mockResolvedValue(reply([notice(), notice({ id: 8, message: 'Another one.' })]));
      const { rerender } = render(<PlatformNoticeBand />);
      fireEvent.click((await screen.findAllByRole('button', { name: 'platform_notice.close' }))[0]!);
      await waitFor(() => expect(screen.queryByTestId('platform-notice-7')).not.toBeInTheDocument());

      now = START + 61_000;
      moveTo('/riverside/admin/users', rerender);

      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId('platform-notice-7')).not.toBeInTheDocument();
      expect(screen.getByTestId('platform-notice-8')).toBeInTheDocument();
    });
  });

  it('treats a kind it does not know as plain information', async () => {
    apiGet.mockResolvedValue(reply([notice({ kind: 'something-new' })]));
    render(<PlatformNoticeBand />);

    expect(within(await screen.findByTestId('platform-notice-7')).getByText('platform_notice.kind.info')).toBeInTheDocument();
  });
});

describe('httpsLink', () => {
  it('accepts a full https address and nothing else', () => {
    expect(httpsLink('https://example.test/a?b=1')).toBe('https://example.test/a?b=1');
    for (const bad of ['', '  ', 'http://example.test', '/path', '//example.test', 'javascript:alert(1)', 'https://a b.test', 'https://u:p@example.test', 'https://', null, 42]) {
      expect(httpsLink(bad)).toBeNull();
    }
  });
});
