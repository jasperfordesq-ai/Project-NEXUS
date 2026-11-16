// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, logError } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), logError: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost } }));
vi.mock('@/lib/logger', () => ({ logError }));
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

  it('takes up no room, and records why, when the notices cannot be loaded', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    const { container } = render(<PlatformNoticeBand />);

    await waitFor(() => expect(logError).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
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
