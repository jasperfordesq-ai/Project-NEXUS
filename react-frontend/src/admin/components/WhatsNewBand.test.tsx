// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}` }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...(rest as object)}>{children}</a>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: string }) => (options?.version ? `${key}|${options.version}` : key),
  }),
}));

import { WHATS_NEW_SEEN_KEY, WhatsNewBand, newestRelease } from './WhatsNewBand';

const INDEX = {
  releases: [
    { version: 'Unreleased', slug: 'unreleased', date: '', isUnreleased: true },
    { version: '3.3.0', slug: '3.3.0', date: '2026-11-20', isUnreleased: false },
    { version: '3.2.0', slug: '3.2.0', date: '2026-11-12', isUnreleased: false },
  ],
};

function answer(body: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }));
}

/** Renders, and waits until the band has asked for the changelog and settled. */
async function settle(): Promise<void> {
  render(<WhatsNewBand />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  await Promise.resolve();
}

describe('newestRelease', () => {
  it('is the first release that is not "Unreleased"', () => {
    expect(newestRelease(INDEX)).toEqual({ version: '3.3.0', slug: '3.3.0' });
  });

  it.each([
    ['nothing', null],
    ['text', '<!doctype html>'],
    ['no list', { releases: 'no' }],
    ['an empty list', { releases: [] }],
    ['only unreleased work', { releases: [INDEX.releases[0]] }],
    ['a release with no slug', { releases: [{ version: '3.3.0', isUnreleased: false }] }],
    ['a release with a blank version', { releases: [{ version: ' ', slug: '3.3.0', isUnreleased: false }] }],
  ])('is null for %s', (_name, value) => {
    expect(newestRelease(value)).toBeNull();
  });
});

describe('WhatsNewBand', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('names the newest released version and links to the changelog', async () => {
    answer(INDEX);
    await settle();

    expect(await screen.findByText('whats_new.message|3.3.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'whats_new.link' })).toHaveAttribute('href', '/test/changelog');
    expect(fetch).toHaveBeenCalledWith('/changelog-data/index.json', expect.anything());
  });

  it('shows nothing when the changelog file is missing', async () => {
    answer(null, false);
    await settle();

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });

  it('shows nothing when the answer is not the changelog (a page of HTML)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) }));
    await settle();

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });

  it('shows nothing when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await settle();

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });

  it('shows nothing when there is no released version yet', async () => {
    answer({ releases: [INDEX.releases[0]] });
    await settle();

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });

  it('closes, and remembers which release was closed', async () => {
    answer(INDEX);
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: 'whats_new.close' }));

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('3.3.0');
  });

  it('stays closed for a release that was closed before', async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, '3.3.0');
    answer(INDEX);
    await settle();

    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });

  it('shows again when a newer release is out', async () => {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, '3.2.0');
    answer(INDEX);
    await settle();

    expect(await screen.findByText('whats_new.message|3.3.0')).toBeInTheDocument();
  });

  it('still shows, and still closes, when the browser will not store anything', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    answer(INDEX);
    await settle();

    fireEvent.click(await screen.findByRole('button', { name: 'whats_new.close' }));
    expect(screen.queryByTestId('whats-new-band')).not.toBeInTheDocument();
  });
});
