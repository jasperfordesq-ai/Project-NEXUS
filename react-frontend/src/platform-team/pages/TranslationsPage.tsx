// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Translations.
 *
 * Two sections, each with its own "not available" state:
 *
 *   - Website wording: `/translation-coverage.json`, written at build time by
 *     `scripts/build-translation-coverage.mjs` over `public/locales`.
 *   - Server wording (emails and messages): `GET /v2/platform-team/translation-coverage`,
 *     counted over `lang/` and kept for an hour; "Count again" asks for a fresh count.
 *
 * Per language: phrases, missing, still the same as English, and the share
 * translated, rounded DOWN so it never says 100% while anything is left.
 * "Same as English" over-counts words meant to be identical (names, units):
 * the page says it is an upper limit. The phone app and the accessible site
 * are not measured, and the page says so.
 *
 * 🔴 The file is checked to be the JSON we expect: a server without a rule for
 * it answers 200 with the app's own HTML (see useChangelog.ts). Missing (404),
 * not the expected JSON, or `available: false` all read "not available on this
 * server". A request that did not complete (no answer, or a server error) is a
 * failure, shown with the error card and a retry: it says nothing about the file.
 *
 * "Count again" refused (too many requests) keeps the figures on screen and says so.
 *
 * 🔴 Read-only. The only control asks for a fresh count.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import RefreshCw from 'lucide-react/icons/refresh-cw';

/** Where the build step writes the website figures. The nginx rule names the same path. */
export const TRANSLATION_COVERAGE_FILE = '/translation-coverage.json';

const ENDPOINT = '/v2/platform-team/translation-coverage';

export interface LocaleCoverage {
  locale: string;
  keys: number;
  missing: number;
  same_as_english: number;
}

export interface CoverageReport {
  available: boolean;
  generated_at?: string | null;
  locales?: LocaleCoverage[] | null;
}

type Section =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'unavailable' }
  | { state: 'ok'; generatedAt: string | null; locales: LocaleCoverage[] };

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** The report, or null when it is not the shape we expect (or says not available). */
function usable(value: unknown): { generatedAt: string | null; locales: LocaleCoverage[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const report = value as CoverageReport;
  if (report.available !== true || !Array.isArray(report.locales)) return null;
  const ok = report.locales.every(
    (row) =>
      typeof row === 'object' && row !== null && typeof row.locale === 'string'
      && isCount(row.keys) && isCount(row.missing) && isCount(row.same_as_english),
  );
  if (!ok) return null;
  return { generatedAt: typeof report.generated_at === 'string' ? report.generated_at : null, locales: report.locales };
}

/** Share translated, rounded down: 100 only when nothing is missing or the same. */
export function percentTranslated(row: LocaleCoverage): number {
  if (row.missing + row.same_as_english === 0) return 100;
  if (row.keys <= 0) return 0;
  const done = Math.max(0, row.keys - row.missing - row.same_as_english);
  return Math.min(99, Math.floor((done * 100) / row.keys));
}

function languageNames(code: string): { own: string; english: string } {
  const name = (inLanguage: string) => {
    try {
      return new Intl.DisplayNames([inLanguage], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  return { own: name(code), english: name('en') };
}

export function TranslationsPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('translations.title'));
  const language = i18n.language;

  const [website, setWebsite] = useState<Section>({ state: 'loading' });
  const [server, setServer] = useState<Section>({ state: 'loading' });
  /** "Count again" is running while the old figures stay on screen. */
  const [recounting, setRecounting] = useState(false);
  /** "Count again" was refused (too many requests); the old figures stay. */
  const [recountRefused, setRecountRefused] = useState(false);
  const serverRef = useRef<Section>(server);
  useEffect(() => {
    serverRef.current = server;
  }, [server]);

  const loadWebsite = useCallback(async () => {
    setWebsite({ state: 'loading' });
    let response: Response;
    try {
      response = await fetch(TRANSLATION_COVERAGE_FILE, { headers: { Accept: 'application/json' } });
    } catch (err) {
      // No answer at all: that says nothing about whether the file exists.
      logError('Failed to fetch the website translation figures', err);
      setWebsite({ state: 'failed' });
      return;
    }
    if (response.status === 404 || response.status === 410) {
      setWebsite({ state: 'unavailable' });
      return;
    }
    if (!response.ok) {
      setWebsite({ state: 'failed' });
      return;
    }
    try {
      const report = usable(await response.json());
      setWebsite(report ? { state: 'ok', ...report } : { state: 'unavailable' });
    } catch {
      // Not JSON (the app's own page): the file is not on this server.
      setWebsite({ state: 'unavailable' });
    }
  }, []);

  const loadServer = useCallback(async (refresh = false) => {
    const shown = serverRef.current.state === 'ok';
    setRecountRefused(false);
    if (refresh && shown) setRecounting(true);
    else setServer({ state: 'loading' });
    try {
      const res = await api.get<CoverageReport>(refresh ? `${ENDPOINT}?refresh=1` : ENDPOINT);
      if (!res.success || !res.data || typeof res.data.available !== 'boolean') {
        if (refresh && shown && res.code === 'RATE_LIMIT_EXCEEDED') {
          setRecountRefused(true);
          return;
        }
        setServer({ state: 'failed' });
        return;
      }
      const report = usable(res.data);
      setServer(report ? { state: 'ok', ...report } : { state: 'unavailable' });
    } catch (err) {
      logError('Failed to load the server translation figures', err);
      setServer({ state: 'failed' });
    } finally {
      setRecounting(false);
    }
  }, []);

  useEffect(() => {
    void loadWebsite();
    void loadServer();
  }, [loadWebsite, loadServer]);

  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const percent = (value: number) => new Intl.NumberFormat(language, { style: 'percent' }).format(value / 100);
  const when = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const renderTable = (prefix: 'website' | 'server', rows: LocaleCoverage[]) => (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-divider md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t(`translations.${prefix}_title`)}</caption>
          <thead>
            <tr className="bg-surface-secondary text-start text-xs text-muted">
              <th scope="col" className="px-3 py-2 font-medium">{t('translations.column.language')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('translations.column.phrases')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('translations.column.missing')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('translations.column.same')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('translations.column.translated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { own, english } = languageNames(row.locale);
              const id = `${prefix}-row-${row.locale}`;
              return (
                <tr key={row.locale} className="border-t border-divider" data-testid={id}>
                  <th scope="row" className="px-3 py-2 text-start font-medium text-foreground">
                    <span lang={row.locale}>{own}</span> <span className="text-muted">({english})</span>
                  </th>
                  <td className="px-3 py-2 text-end tabular-nums text-foreground" data-testid={`${id}-keys`}>{number(row.keys)}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-foreground" data-testid={`${id}-missing`}>{number(row.missing)}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-foreground" data-testid={`${id}-same`}>{number(row.same_as_english)}</td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums text-foreground" data-testid={`${id}-percent`}>
                    {percent(percentTranslated(row))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => {
          const { own, english } = languageNames(row.locale);
          const id = `${prefix}-card-${row.locale}`;
          const fact = (label: string, value: string) => (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="tabular-nums text-foreground">{value}</dd>
            </div>
          );
          return (
            <li key={row.locale} data-testid={id}>
              <Card>
                <CardBody className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="min-w-0 break-words text-base font-semibold text-foreground">
                      <span lang={row.locale}>{own}</span> <span className="text-sm font-normal text-muted">({english})</span>
                    </h3>
                    <span className="text-base font-semibold tabular-nums text-foreground">{percent(percentTranslated(row))}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {fact(t('translations.column.phrases'), number(row.keys))}
                    {fact(t('translations.column.missing'), number(row.missing))}
                    {fact(t('translations.column.same'), number(row.same_as_english))}
                  </dl>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );

  const renderSection = (prefix: 'website' | 'server', section: Section, onRetry: () => void) => (
    <section aria-labelledby={`translations-${prefix}`} className="flex flex-col gap-3">
      <div>
        <h2 id={`translations-${prefix}`} className="text-lg font-semibold text-foreground">
          {t(`translations.${prefix}_title`)}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t(`translations.${prefix}_intro`)}</p>
      </div>

      {section.state === 'loading' ? (
        <div role="status" aria-busy="true" aria-label={t('translations.loading')} className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : section.state === 'failed' ? (
        <LoadError title={t(`translations.${prefix}_load_error`)} onRetry={onRetry} />
      ) : section.state === 'unavailable' ? (
        <Card>
          <CardBody className="p-4" role="status">
            <p className="text-sm text-foreground">{t(`translations.${prefix}_unavailable`)}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          {prefix === 'server' && recountRefused ? (
            <p className="text-sm font-medium text-warning-soft-foreground" role="status">
              {t('translations.recount_refused')}
            </p>
          ) : null}
          {when(section.generatedAt) ? (
            <p className="text-xs text-muted">{t('translations.counted_at', { date: when(section.generatedAt) })}</p>
          ) : null}
          {renderTable(prefix, section.locales)}
          <p className="max-w-2xl text-sm text-muted">{t('translations.same_note')}</p>
        </>
      )}
    </section>
  );

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('translations.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('translations.intro')}</p>
        </div>
        <Button
          variant="tertiary"
          onPress={() => {
            void loadWebsite();
            void loadServer(true);
          }}
          isDisabled={server.state === 'loading' || recounting}
          isLoading={recounting}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t('translations.recount')}
        </Button>
      </div>

      <div className="flex flex-col gap-8">
        {renderSection('website', website, () => void loadWebsite())}
        {renderSection('server', server, () => void loadServer())}
        <p className="text-sm text-muted">{t('translations.not_measured')}</p>
      </div>
    </section>
  );
}

export default TranslationsPage;
