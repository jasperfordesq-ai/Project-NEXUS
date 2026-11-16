// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — home page: is everything the platform runs on working?
 *
 * One request (`GET /v2/platform-team/health`, platform team only) returns a
 * card per check. The page adds nothing of its own except whether THIS
 * browser is on the build the server is running.
 *
 * 🔴 Four states, each said in words as well as colour:
 * fine, needs a look, not working, and **could not be checked**. A check the
 * server could not read arrives as `unknown` and is shown as exactly that. It
 * is never shown as fine. The same goes for the whole page: if the request
 * itself is refused or fails, the error card is shown, not an empty grid.
 *
 * A card whose key this page has no wording for is still shown, under its
 * key, so a check added on the server is never silently dropped here.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CircleHelp from 'lucide-react/icons/circle-help';
import Database from 'lucide-react/icons/database';
import FileText from 'lucide-react/icons/file-text';
import HardDrive from 'lucide-react/icons/hard-drive';
import Mail from 'lucide-react/icons/mail';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Rocket from 'lucide-react/icons/rocket';
import Search from 'lucide-react/icons/search';
import Timer from 'lucide-react/icons/timer';
import Wrench from 'lucide-react/icons/wrench';
import Zap from 'lucide-react/icons/zap';
import type { LucideIcon } from 'lucide-react';

type HealthStatus = 'ok' | 'warning' | 'failing' | 'unknown';

interface HealthFact {
  key: string;
  value: string | number | boolean | null;
  type: 'text' | 'count' | 'datetime' | 'bool' | 'percent';
}

interface HealthCard {
  key: string;
  status: HealthStatus;
  facts: HealthFact[];
}

interface HealthSummary {
  generated_at: string;
  overall: HealthStatus;
  cards: HealthCard[];
}

const STATUSES: HealthStatus[] = ['ok', 'warning', 'failing', 'unknown'];

const CHIP_COLOR: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  ok: 'success',
  warning: 'warning',
  failing: 'danger',
  unknown: 'default',
};

const CARD_ICON: Record<string, LucideIcon> = {
  release: Rocket,
  database: Database,
  cache: Zap,
  disk: HardDrive,
  queue: Activity,
  failed_jobs: AlertTriangle,
  cron: Timer,
  email: Mail,
  search: Search,
  snapshots: FileText,
  maintenance: Wrench,
};

/** The panel page that holds the detail behind a card, where one exists. */
const CARD_PAGE: Record<string, string> = {
  database: '/platform-team/enterprise/monitoring',
  cache: '/platform-team/enterprise/monitoring',
  disk: '/platform-team/enterprise/monitoring',
  cron: '/platform-team/cron-jobs',
  email: '/platform-team/email-deliverability',
  snapshots: '/platform-team/seo/prerender',
};

function asStatus(value: unknown): HealthStatus {
  // Anything the page does not recognise is "could not be checked", never "fine".
  return STATUSES.includes(value as HealthStatus) ? (value as HealthStatus) : 'unknown';
}

/**
 * Is this browser running the build the server is running? `null` when either
 * side is not a real build id (a development machine, a test run), because a
 * guess would be worse than saying nothing.
 */
export function sameBuild(serverCommit: string | null, browserBuild: string): boolean | null {
  const notABuild = (value: string | null) => !value || ['dev', 'test', 'unknown', 'development'].includes(value);
  if (notABuild(serverCommit) || notABuild(browserBuild)) return null;

  const server = String(serverCommit);
  return server.startsWith(browserBuild) || browserBuild.startsWith(server);
}

export function PlatformTeamHome() {
  const { t, i18n } = useTranslation('platform_team');
  const { tenantPath } = useTenant();
  usePageTitle(t('nav.brand'));

  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<HealthSummary>('/v2/platform-team/health');
      if (res.success && res.data && Array.isArray(res.data.cards)) {
        setSummary(res.data);
      } else {
        setSummary(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the platform health summary', err);
      setSummary(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const wording = (key: string, fallback: string): string =>
    i18n.exists(`platform_team:${key}`) ? String(t(key as never)) : fallback;

  const factValue = (fact: HealthFact): string => {
    if (fact.value === null || fact.value === undefined || fact.value === '') return t('home.value.not_known');
    if (fact.type === 'bool') return fact.value ? t('home.value.yes') : t('home.value.no');
    if (fact.type === 'percent') return `${fact.value}%`;
    if (fact.type === 'datetime') {
      const date = new Date(String(fact.value));
      return Number.isNaN(date.getTime()) ? t('home.value.not_known') : date.toLocaleString(i18n.language);
    }
    return String(fact.value);
  };

  const overall = summary ? asStatus(summary.overall) : 'unknown';
  const checkedAt = summary ? new Date(summary.generated_at) : null;

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('home.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('home.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !summary ? (
        <div role="status" aria-busy="true" aria-label={t('home.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !summary ? (
        <LoadError title={t('home.load_error_title')} onRetry={() => void load()} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3" aria-live="polite">
            <Chip size="md" variant="soft" color={CHIP_COLOR[overall]}>
              {t(`home.overall.${overall}`)}
            </Chip>
            {checkedAt && !Number.isNaN(checkedAt.getTime()) && (
              <span className="text-sm text-muted">
                {t('home.checked_at', { time: checkedAt.toLocaleTimeString(i18n.language) })}
              </span>
            )}
          </div>

          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summary.cards.map((card) => {
              const status = asStatus(card.status);
              const Icon = CARD_ICON[card.key] ?? CircleHelp;
              const page = CARD_PAGE[card.key];
              const match =
                card.key === 'release'
                  ? sameBuild(
                      (card.facts.find((fact) => fact.key === 'commit')?.value as string | null | undefined) ?? null,
                      __BUILD_COMMIT__,
                    )
                  : null;

              return (
                <li key={card.key} data-testid={`health-card-${card.key}`}>
                  <Card className="h-full">
                    <CardBody className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon size={20} className="shrink-0 text-muted" aria-hidden="true" />
                          <h2 className="text-base font-semibold text-foreground">
                            {wording(`home.card.${card.key}`, card.key)}
                          </h2>
                        </div>
                        <Chip size="sm" variant="soft" color={CHIP_COLOR[status]} className="shrink-0">
                          {t(`home.status.${status}`)}
                        </Chip>
                      </div>

                      {status === 'unknown' && <p className="text-sm text-muted">{t('home.unknown_note')}</p>}

                      {card.facts.length > 0 && (
                        <dl className="flex flex-col gap-1 text-sm">
                          {card.facts.map((fact) => (
                            <div key={fact.key} className="flex items-baseline justify-between gap-3">
                              <dt className="text-muted">{wording(`home.fact.${fact.key}`, fact.key)}</dt>
                              <dd className="min-w-0 break-words text-end font-medium text-foreground">
                                {factValue(fact)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      {match !== null && (
                        <p className="text-sm text-muted">
                          {match ? t('home.value.browser_same') : t('home.value.browser_other')}
                        </p>
                      )}

                      {page && (
                        <Link
                          to={tenantPath(page)}
                          className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                        >
                          {t('home.open_page')}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      )}
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default PlatformTeamHome;
