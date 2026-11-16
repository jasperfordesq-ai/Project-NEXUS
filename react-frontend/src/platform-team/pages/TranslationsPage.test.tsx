// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'date' in options) return `${key}|${String(options.date)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { TranslationsPage, TRANSLATION_COVERAGE_FILE, type CoverageReport } from './TranslationsPage';

const server = (over: Partial<CoverageReport> = {}): CoverageReport => ({
  available: true,
  generated_at: '2026-11-16T10:00:00+00:00',
  locales: [
    { locale: 'de', keys: 200, missing: 3, same_as_english: 10 },
    { locale: 'ja', keys: 200, missing: 0, same_as_english: 0 },
  ],
  ...over,
});

const website: CoverageReport = {
  available: true,
  generated_at: '2026-11-16T09:00:00.000Z',
  locales: [
    { locale: 'fr', keys: 1000, missing: 1, same_as_english: 0 },
    { locale: 'ga', keys: 1000, missing: 0, same_as_english: 0 },
  ],
};

const fetchMock = vi.fn();

function fileAnswers(body: unknown, init: { ok?: boolean; contentType?: string } = {}) {
  fetchMock.mockResolvedValue({
    ok: init.ok ?? true,
    status: init.ok === false ? 404 : 200,
    headers: { get: () => init.contentType ?? 'application/json' },
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token <');
      return body;
    },
  });
}

describe('TranslationsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: server() });
    fetchMock.mockReset();
    fileAnswers(website);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the server figures from the platform team request and the website figures from the build file', async () => {
    render(<TranslationsPage />);

    await screen.findByTestId('server-row-de');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/translation-coverage');
    expect(fetchMock).toHaveBeenCalledWith(TRANSLATION_COVERAGE_FILE, expect.anything());
    expect(TRANSLATION_COVERAGE_FILE).toBe('/translation-coverage.json');
    expect(await screen.findByTestId('website-row-fr')).toBeInTheDocument();
  });

  it('names each language in its own words and in English', async () => {
    render(<TranslationsPage />);

    const row = await screen.findByTestId('server-row-de');
    expect(row).toHaveTextContent('Deutsch');
    expect(row).toHaveTextContent('German');
    expect(await screen.findByTestId('website-row-fr')).toHaveTextContent('français');
  });

  it('shows phrases, missing, still the same as English, and a percentage rounded down', async () => {
    render(<TranslationsPage />);

    const row = await screen.findByTestId('server-row-de');
    expect(within(row).getByTestId('server-row-de-keys')).toHaveTextContent('200');
    expect(within(row).getByTestId('server-row-de-missing')).toHaveTextContent('3');
    expect(within(row).getByTestId('server-row-de-same')).toHaveTextContent('10');
    // (200 - 3 - 10) / 200 = 93.5 % → 93 %
    expect(within(row).getByTestId('server-row-de-percent')).toHaveTextContent('93%');
    expect(within(screen.getByTestId('server-row-ja')).getByTestId('server-row-ja-percent')).toHaveTextContent('100%');
  });

  it('never shows 100% while anything is missing', async () => {
    render(<TranslationsPage />);

    // 999 / 1000 = 99.9 % → 99 %
    const row = await screen.findByTestId('website-row-fr');
    expect(within(row).getByTestId('website-row-fr-percent')).toHaveTextContent('99%');
  });

  it('says "same as English" is an upper limit, and what is not measured', async () => {
    render(<TranslationsPage />);

    await screen.findByTestId('server-row-de');
    expect(screen.getAllByText('translations.same_note')).toHaveLength(2);
    expect(screen.getByText('translations.not_measured')).toBeInTheDocument();
  });

  it('says the website figures are not available when the file is missing', async () => {
    fileAnswers({}, { ok: false });
    render(<TranslationsPage />);

    expect(await screen.findByText('translations.website_unavailable')).toBeInTheDocument();
    // The server section is unaffected.
    expect(await screen.findByTestId('server-row-de')).toBeInTheDocument();
  });

  it('says not available when the server answers with the app page instead of the file', async () => {
    fileAnswers('<!doctype html>', { contentType: 'text/html' });
    render(<TranslationsPage />);

    expect(await screen.findByText('translations.website_unavailable')).toBeInTheDocument();
  });

  it('says not available when the build could not count', async () => {
    fileAnswers({ available: false });
    render(<TranslationsPage />);

    expect(await screen.findByText('translations.website_unavailable')).toBeInTheDocument();
  });

  it('says the server figures are not available, never zero, when the server cannot read them', async () => {
    apiGet.mockResolvedValue({ success: true, data: { available: false, generated_at: null, locales: null } });
    render(<TranslationsPage />);

    expect(await screen.findByText('translations.server_unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('server-row-de')).not.toBeInTheDocument();
    expect(await screen.findByTestId('website-row-fr')).toBeInTheDocument();
  });

  it('shows an error with a retry when the server request fails', async () => {
    apiGet.mockRejectedValueOnce(new Error('network'));
    render(<TranslationsPage />);

    const retry = await screen.findByRole('button', { name: /retry|try again/i });
    fireEvent.click(retry);
    expect(await screen.findByTestId('server-row-de')).toBeInTheDocument();
  });

  it('counts the server figures again on request', async () => {
    render(<TranslationsPage />);

    await screen.findByTestId('server-row-de');
    fireEvent.click(screen.getByRole('button', { name: 'translations.recount' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/translation-coverage?refresh=1'));
  });
});

describe('the server actually serves the file the Translations page asks for', () => {
  it('blue/green nginx has an exact-match rule that reads it from disk and 404s when absent', () => {
    const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const conf = readFileSync(path.join(frontendRoot, 'nginx.bluegreen.conf'), 'utf8');
    const rule = `location = ${TRANSLATION_COVERAGE_FILE} {`;

    expect(conf).toContain(rule);
    const block = conf.slice(conf.indexOf(rule));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).toMatch(/try_files\s+\$uri\s+=404;/);
    expect(body).toMatch(/default_type\s+application\/json;/);
  });
});
