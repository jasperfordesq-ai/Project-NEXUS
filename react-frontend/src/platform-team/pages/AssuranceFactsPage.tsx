// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Assurance facts.
 *
 * Facts the platform can measure about itself today
 * (`GET /v2/platform-team/assurance`, platform team only): the live version,
 * two-step sign-in on senior accounts, the access review, the daily backup
 * check, requests about personal data, since when failed sign-ins are counted,
 * and the date of the last independent security test the owner entered.
 *
 * 🔴 An internal page. It names no customer and no community, claims nothing
 * (only what was measured and when), and has no export, print or copy: the
 * only control reloads. Each fact links to the page that owns it.
 *
 * 🔴 A fact the server could not read says "Could not be read", never a zero
 * or a tick.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CircleHelp from 'lucide-react/icons/circle-help';
import Info from 'lucide-react/icons/info';

interface FactBase<K extends string> {
  key: K;
  available: boolean;
}

export type AssuranceFact =
  | (FactBase<'release'> & { version: string | null; commit_short: string | null; deployed_at: string | null })
  | (FactBase<'two_step'> & { senior_accounts: number | null; with_two_step: number | null; truncated: boolean | null })
  | (FactBase<'access_review'> & { last_review_at: string | null; due: boolean | null })
  | (FactBase<'backup'> & {
      state: 'healthy' | 'stale' | 'missing' | 'empty' | 'unreadable' | 'other' | null;
      newest_at: string | null;
      checked_at: string | null;
    })
  | (FactBase<'data_requests'> & { open: number | null; overdue: number | null })
  | (FactBase<'failed_sign_ins'> & { counted_since: string | null })
  | (FactBase<'independent_test'> & { date: string | null });

export interface AssuranceFacts {
  generated_at: string;
  facts: AssuranceFact[];
}

/** Where each fact comes from: its own page in the panel, and the wording key of that page's name. */
const SOURCE: Record<AssuranceFact['key'], { path: string; label: string } | null> = {
  release: { path: '/platform-team', label: 'home.title' },
  two_step: { path: '/platform-team/senior-accounts', label: 'senior_accounts.title' },
  access_review: { path: '/platform-team/access-review', label: 'access_review.title' },
  backup: { path: '/platform-team', label: 'home.title' },
  data_requests: { path: '/platform-team/data-requests', label: 'data_requests.title' },
  failed_sign_ins: { path: '/platform-team/security', label: 'security.title' },
  independent_test: null,
};

export function AssuranceFactsPage() {
  const { t, i18n } = useTranslation('platform_team');
  const { tenantPath } = useTenant();
  usePageTitle(t('assurance.title'));
  const language = i18n.language;

  const [data, setData] = useState<AssuranceFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<AssuranceFacts>('/v2/platform-team/assurance');
      if (res.success && res.data && Array.isArray(res.data.facts)) {
        setData(res.data);
      } else {
        setData(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the assurance facts', err);
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateTime = (iso: string | null): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  // A calendar date (YYYY-MM-DD) is shown as that day, whatever the viewer's time zone.
  const calendarDate = (value: string): string => {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(language, { dateStyle: 'long', timeZone: 'UTC' });
  };

  const number = (value: number) => new Intl.NumberFormat(language).format(value);

  const lines = (fact: AssuranceFact): ReactNode[] => {
    switch (fact.key) {
      case 'release': {
        const deployed = dateTime(fact.deployed_at);
        return [
          fact.version ? t('assurance.release.version', { version: fact.version }) : t('assurance.not_recorded'),
          fact.commit_short ? t('assurance.release.commit', { code: fact.commit_short }) : null,
          deployed ? t('assurance.release.deployed', { date: deployed }) : t('assurance.release.deployed_unknown'),
        ];
      }
      case 'two_step':
        return [
          t('assurance.two_step.value', { with: number(fact.with_two_step ?? 0), total: number(fact.senior_accounts ?? 0) }),
          fact.truncated ? t('assurance.two_step.truncated') : null,
        ];
      case 'access_review': {
        const last = dateTime(fact.last_review_at);
        return [
          last ? t('assurance.access_review.last', { date: last }) : t('assurance.access_review.never'),
          fact.due ? t('assurance.access_review.due') : t('assurance.access_review.not_due'),
        ];
      }
      case 'backup': {
        const newest = dateTime(fact.newest_at);
        const checked = dateTime(fact.checked_at);
        return [
          t(`assurance.backup.state.${fact.state ?? 'other'}`),
          newest ? t('assurance.backup.newest', { date: newest }) : null,
          checked ? t('assurance.backup.checked', { date: checked }) : null,
        ];
      }
      case 'data_requests':
        return [
          t('assurance.data_requests.open', { count: fact.open ?? 0 }),
          t('assurance.data_requests.overdue', { count: fact.overdue ?? 0 }),
        ];
      case 'failed_sign_ins': {
        const since = dateTime(fact.counted_since);
        return [
          since ? t('assurance.failed_sign_ins.since', { date: since }) : t('assurance.failed_sign_ins.none'),
          t('assurance.failed_sign_ins.note'),
        ];
      }
      case 'independent_test':
        return [
          fact.date ? t('assurance.independent_test.date', { date: calendarDate(fact.date) }) : t('assurance.independent_test.none'),
        ];
    }
  };

  const readAt = data ? dateTime(data.generated_at) : null;

  const card = (fact: AssuranceFact) => {
    const source = SOURCE[fact.key];
    return (
      <li key={fact.key} data-testid={`assurance-fact-${fact.key}`}>
        <Card className="h-full">
          <CardBody className="flex h-full flex-col gap-3 p-4">
            <h2 className="text-base font-semibold text-foreground">{t(`assurance.${fact.key}.title`)}</h2>
            {fact.available ? (
              <ul className="flex flex-col gap-1">
                {lines(fact)
                  .filter((line): line is string => typeof line === 'string' && line !== '')
                  .map((line) => (
                    <li key={line} className="break-words text-sm text-foreground">
                      {line}
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-1" role="status">
                <p className="inline-flex items-center gap-1 text-sm font-medium text-warning">
                  <CircleHelp size={16} aria-hidden="true" />
                  {t('assurance.could_not_read')}
                </p>
                {fact.key === 'backup' ? <p className="text-sm text-muted">{t('assurance.backup.not_available')}</p> : null}
              </div>
            )}
            <div className="mt-auto flex flex-col gap-1 border-t border-divider pt-3">
              {readAt ? <p className="text-xs text-muted">{t('assurance.read_at', { time: readAt })}</p> : null}
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
                <span>{t('assurance.source_label')}</span>
                {source ? (
                  <Link
                    to={tenantPath(source.path)}
                    className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                  >
                    {t(source.label)}
                    <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                ) : (
                  <span>{t('assurance.source_owner')}</span>
                )}
              </p>
            </div>
          </CardBody>
        </Card>
      </li>
    );
  };

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('assurance.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('assurance.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !data ? (
        <div role="status" aria-busy="true" aria-label={t('assurance.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !data ? (
        <LoadError title={t('assurance.load_error_title')} onRetry={() => void load()} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">{data.facts.map(card)}</ul>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <p className="inline-flex items-start gap-2 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('assurance.findings_note')}</span>
        </p>
        <p className="inline-flex items-start gap-2 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('assurance.test_scope_note')}</span>
        </p>
      </div>
    </section>
  );
}

export default AssuranceFactsPage;
