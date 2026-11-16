// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Usage per community.
 *
 * For one month, what each community used of the services the platform pays
 * for and records: emails (sent, failed, bounced), AI chat (requests, tokens,
 * cost), and the space its groups' files take today.
 *
 * 🔴 A part the server could not read says "Not available", never 0. What is
 * not recorded anywhere (maps, translation, other stored files) is listed in
 * words under "Not recorded today", never shown as a zero.
 *
 * 🔴 Read-only. The only controls change the month or reload.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';

interface EmailCounts {
  sent: number;
  failed: number;
  bounced: number;
}

interface AiChatUse {
  requests: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageCommunity {
  id: number;
  /** null when the community no longer exists but its records do. */
  name: string | null;
  slug: string | null;
  is_active: boolean;
  /** null when that part could not be read. */
  emails: EmailCounts | null;
  ai_chat: AiChatUse | null;
  group_file_bytes: number | null;
}

type NotRecorded = 'maps' | 'translation' | 'other_storage';

export interface UsageReport {
  month: string;
  is_current_month: boolean;
  sources: { emails: boolean; ai_chat: boolean; group_files: boolean };
  communities: UsageCommunity[];
  platform_mail: EmailCounts | null;
  totals: { emails: EmailCounts | null; ai_chat: AiChatUse | null; group_file_bytes: number | null };
  not_recorded: NotRecorded[];
}

const KNOWN_NOT_RECORDED: readonly NotRecorded[] = ['maps', 'translation', 'other_storage'];

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Megabytes below one gigabyte, gigabytes above, in the viewer's language. */
export function formatBytes(bytes: number, language: string): string {
  const [value, unit] = bytes >= GB ? [bytes / GB, 'gigabyte'] : [bytes / MB, 'megabyte'];
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: value > 0 && value < 10 ? 1 : 0,
  }).format(value);
}

/** US dollars, as the AI service charges. A cost under a cent keeps its digits rather than reading as nothing. */
export function formatUsd(amount: number, language: string): string {
  const tiny = amount > 0 && amount < 0.01;
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: tiny ? 4 : 2,
  }).format(amount);
}

/** 'YYYY-MM' as [year, month 1–12]. */
function partsOf(month: string): [number, number] {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return [year, mon];
}

/** 'YYYY-MM' moved by whole months. */
function shiftMonth(month: string, by: number): string {
  const [year, mon] = partsOf(month);
  const index = year * 12 + (mon - 1) + by;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function UsagePage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('usage.title'));
  const language = i18n.language;

  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (month?: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const url = month ? `/v2/platform-team/usage?month=${encodeURIComponent(month)}` : '/v2/platform-team/usage';
      const res = await api.get<UsageReport>(url);
      if (res.success && res.data && Array.isArray(res.data.communities) && typeof res.data.month === 'string') {
        setReport(res.data);
      } else {
        setReport(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load usage per community', err);
      setReport(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const number = (n: number) => new Intl.NumberFormat(language).format(n);

  const monthLabel = (month: string) => {
    const [year, mon] = partsOf(month);
    return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(language, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const notAvailable = (testId: string) => (
    <span className="text-sm text-warning-soft-foreground" data-testid={testId}>
      {t('usage.not_available')}
    </span>
  );

  const figure = (label: string, value: ReactNode, testId: string) => (
    <div className="min-w-0">
      <dt className="break-words text-xs text-muted">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );

  const emailFigures = (emails: EmailCounts | null, prefix: string) =>
    emails === null ? (
      <div className="col-span-full">
        <dt className="text-xs text-muted">{t('usage.emails_heading')}</dt>
        <dd>{notAvailable(`${prefix}-sent`)}</dd>
      </div>
    ) : (
      <>
        {figure(t('usage.sent'), number(emails.sent), `${prefix}-sent`)}
        {figure(t('usage.failed'), number(emails.failed), `${prefix}-failed`)}
        {figure(t('usage.bounced'), number(emails.bounced), `${prefix}-bounced`)}
      </>
    );

  const aiFigures = (ai: AiChatUse | null, prefix: string) =>
    ai === null ? (
      <div className="col-span-full">
        <dt className="text-xs text-muted">{t('usage.ai_heading')}</dt>
        <dd>{notAvailable(`${prefix}-ai_requests`)}</dd>
      </div>
    ) : (
      <>
        {figure(t('usage.ai_requests'), number(ai.requests), `${prefix}-ai_requests`)}
        {figure(t('usage.ai_tokens'), number(ai.tokens), `${prefix}-ai_tokens`)}
        {figure(t('usage.ai_cost'), formatUsd(ai.cost_usd, language), `${prefix}-ai_cost`)}
      </>
    );

  const filesFigure = (bytes: number | null, prefix: string) =>
    figure(t('usage.files'), bytes === null ? t('usage.not_available') : formatBytes(bytes, language), `${prefix}-files`);

  const communityCard = (community: UsageCommunity) => {
    const prefix = `usage-${community.id}`;
    return (
      <li key={community.id} data-testid={`usage-community-${community.id}`}>
        <Card>
          <CardBody className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-base font-semibold text-foreground">
                {community.name ?? t('usage.removed_community', { id: community.id })}
              </h3>
              {!community.is_active ? (
                <Chip size="sm" variant="soft" color="warning">
                  {t('usage.not_active')}
                </Chip>
              ) : null}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted">{t('usage.emails_heading')}</h4>
                <dl className="grid grid-cols-3 gap-2">{emailFigures(community.emails, prefix)}</dl>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted">{t('usage.ai_heading')}</h4>
                <dl className="grid grid-cols-3 gap-2">{aiFigures(community.ai_chat, prefix)}</dl>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium text-muted">{t('usage.files_heading')}</h4>
                <dl>{filesFigure(community.group_file_bytes, prefix)}</dl>
              </div>
            </div>
          </CardBody>
        </Card>
      </li>
    );
  };

  const unavailableSources = report
    ? (['emails', 'ai_chat', 'group_files'] as const).filter((source) => report.sources?.[source] === false)
    : [];

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('usage.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('usage.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load(report?.month)} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {report ? (
        <div className="mb-6 flex items-center gap-2" role="group" aria-label={t('usage.month_picker')}>
          <Button
            isIconOnly
            variant="tertiary"
            aria-label={t('usage.previous_month')}
            onPress={() => void load(shiftMonth(report.month, -1))}
            isDisabled={loading}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <p className="min-w-40 text-center text-base font-semibold text-foreground" aria-live="polite">
            {monthLabel(report.month)}
          </p>
          <Button
            isIconOnly
            variant="tertiary"
            aria-label={t('usage.next_month')}
            onPress={() => void load(shiftMonth(report.month, 1))}
            isDisabled={loading || report.is_current_month}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {loading && !report ? (
        <div role="status" aria-busy="true" aria-label={t('usage.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !report ? (
        <LoadError title={t('usage.load_error_title')} onRetry={() => void load(report?.month)} />
      ) : (
        <div className="flex flex-col gap-8">
          {report.is_current_month ? <p className="text-sm text-muted">{t('usage.month_so_far')}</p> : null}

          {unavailableSources.length > 0 ? (
            <div className="flex flex-col gap-1" role="status">
              {unavailableSources.map((source) => (
                <p key={source} className="text-sm text-warning-soft-foreground">
                  {t(`usage.unavailable.${source}`)}
                </p>
              ))}
            </div>
          ) : null}

          <section aria-labelledby="usage-totals-heading">
            <h2 id="usage-totals-heading" className="mb-3 text-lg font-semibold text-foreground">
              {t('usage.totals_heading')}
            </h2>
            <Card>
              <CardBody className="grid gap-4 p-4 sm:grid-cols-3" data-testid="usage-totals">
                <div>
                  <h3 className="mb-1 text-sm font-medium text-muted">{t('usage.emails_heading')}</h3>
                  <dl className="grid grid-cols-3 gap-2">{emailFigures(report.totals.emails, 'usage-total')}</dl>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium text-muted">{t('usage.ai_heading')}</h3>
                  <dl className="grid grid-cols-3 gap-2">{aiFigures(report.totals.ai_chat, 'usage-total')}</dl>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium text-muted">{t('usage.files_heading')}</h3>
                  <dl>{filesFigure(report.totals.group_file_bytes, 'usage-total')}</dl>
                </div>
              </CardBody>
            </Card>
          </section>

          <section aria-labelledby="usage-communities-heading">
            <h2 id="usage-communities-heading" className="mb-3 text-lg font-semibold text-foreground">
              {t('usage.communities_heading', { count: report.communities.length })}
            </h2>
            {report.communities.length === 0 ? (
              <p className="text-sm text-muted">{t('usage.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-3">{report.communities.map(communityCard)}</ul>
            )}
          </section>

          <section aria-labelledby="usage-platform-mail-heading">
            <h2 id="usage-platform-mail-heading" className="mb-1 text-lg font-semibold text-foreground">
              {t('usage.platform_mail')}
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-muted">{t('usage.platform_mail_note')}</p>
            <Card>
              <CardBody className="p-4" data-testid="usage-platform-mail">
                <span className="sr-only">{t('usage.platform_mail')}</span>
                {report.platform_mail === null ? (
                  notAvailable('usage-platform-sent')
                ) : (
                  <dl className="grid max-w-md grid-cols-3 gap-2">{emailFigures(report.platform_mail, 'usage-platform')}</dl>
                )}
              </CardBody>
            </Card>
          </section>

          <section aria-labelledby="usage-notes-heading" className="max-w-2xl">
            <h2 id="usage-notes-heading" className="mb-2 text-lg font-semibold text-foreground">
              {t('usage.notes_heading')}
            </h2>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
              <li>{t('usage.sent_note')}</li>
              <li>{t('usage.ai_note')}</li>
              <li>{t('usage.files_note')}</li>
            </ul>
          </section>

          <section aria-labelledby="usage-not-recorded-heading" className="max-w-2xl" data-testid="usage-not-recorded">
            <h2 id="usage-not-recorded-heading" className="mb-1 text-lg font-semibold text-foreground">
              {t('usage.not_recorded_heading')}
            </h2>
            <p className="mb-2 text-sm text-muted">{t('usage.not_recorded_intro')}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
              {(report.not_recorded ?? [])
                .filter((key): key is NotRecorded => KNOWN_NOT_RECORDED.includes(key))
                .map((key) => (
                  <li key={key}>{t(`usage.not_recorded.${key}`)}</li>
                ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}

export default UsagePage;
