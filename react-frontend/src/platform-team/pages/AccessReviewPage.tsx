// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Access review.
 *
 * Go through every senior account (as the Senior accounts page lists them) and
 * choose "Keep" or "Should be removed" for each. Nothing is chosen in advance,
 * so every account is a deliberate choice, and the Record button stays off
 * until every account has one.
 *
 * 🔴 Recording a review changes nobody's access. The page says so, and says
 * where access is actually removed. Nothing should be added here that removes
 * access.
 *
 * 🔴 A review that cannot be loaded shows the error card, never an empty list.
 *
 * The second sign-in step: the server asks for a recent code before it records
 * a review. The API client handles that by itself (lib/api.ts): it opens the
 * code prompt (components/security/StepUpPrompt), then sends the same request
 * again, and only then does `api.post()` below finish. When the person closes
 * the prompt, the refusal comes back with the code AUTH_STEP_UP_REQUIRED and
 * nothing was recorded; the choices stay as they were.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Radio, RadioGroup, Spinner, Textarea } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api, AUTH_STEP_UP_REQUIRED } from '@/lib/api';
import { logError } from '@/lib/logger';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { SENIOR_LEVELS, accountStatusKey, type SeniorLevel } from './SeniorAccountsPage';
import { getFormattingLocale } from '@/lib/helpers';

const URL = '/v2/platform-team/access-review';

/** The server's own limits (AccessReviewService). The server checks them again. */
export const NOTE_MAX = 500;
const DUE_AFTER_DAYS = 90;

type Decision = 'keep' | 'remove';

export interface ReviewAccount {
  id: number;
  name: string | null;
  level: SeniorLevel;
  community: { id: number; name: string | null } | null;
  status: string;
  last_sign_in_at: string | null;
  two_step_on: boolean;
}

export interface ReviewSummary {
  id: number;
  at: string;
  /** Read now, never stored. Null when the account is erased or gone. */
  by_name: string | null;
  account_count: number;
  remove_count: number;
}

export interface OpenRemoval {
  id: number;
  name: string | null;
  level: SeniorLevel;
  community: { id: number; name: string | null } | null;
}

export interface AccessReview {
  due: boolean;
  days_since_last: number | null;
  last_review: ReviewSummary | null;
  accounts: ReviewAccount[];
  history: ReviewSummary[];
  open_removals: OpenRemoval[];
}

type RecordError = 'step_cancelled' | 'list_changed' | 'failed';

export function AccessReviewPage() {
  const { t } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('access_review.title'));

  const [data, setData] = useState<AccessReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<RecordError | null>(null);
  /** A refresh failed while a review was already on screen: the review stays, with a short line. */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setRefreshFailed(false);
    setRecordError(null);
    let reply: AccessReview | null = null;
    try {
      const res = await api.get<AccessReview>(URL);
      if (res.success && res.data && Array.isArray(res.data.accounts)) reply = res.data;
    } catch (err) {
      logError('Failed to load the access review', err);
    }
    if (reply !== null) {
      const stillListed = new Set(reply.accounts.map((a) => a.id));
      setData(reply);
      hasData.current = true;
      // Keep every choice already made for an account that is still on the list.
      setDecisions((prev) => {
        const kept: Record<number, Decision> = {};
        for (const [id, decision] of Object.entries(prev)) {
          if (stillListed.has(Number(id))) kept[Number(id)] = decision;
        }
        return kept;
      });
    } else if (hasData.current) {
      setRefreshFailed(true);
    } else {
      setData(null);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const day = (iso: string | null): string => {
    if (!iso) return t('senior_accounts.never');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('senior_accounts.never')
      : date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const communityName = (community: { id: number; name: string | null } | null): string =>
    community === null
      ? t('senior_accounts.no_community')
      : (community.name ?? t('senior_accounts.unnamed_community', { id: community.id }));

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const decided = accounts.filter((a) => decisions[a.id] !== undefined).length;
  const cleanNote = note.trim();
  const canRecord = accounts.length > 0 && decided === accounts.length && cleanNote.length <= NOTE_MAX && !recording;

  const record = async () => {
    if (!canRecord) return;
    setRecording(true);
    setRecordError(null);
    try {
      const body: { decisions: Array<{ user_id: number; decision: Decision }>; note?: string } = {
        decisions: accounts.map((a) => ({ user_id: a.id, decision: decisions[a.id] as Decision })),
      };
      if (cleanNote !== '') body.note = cleanNote;
      // May pause here while the person enters their sign-in code (see the top of this file).
      const res = await api.post<AccessReview>(URL, body);
      if (res.success && res.data && Array.isArray(res.data.accounts)) {
        setData(res.data);
        setDecisions({});
        setNote('');
        toast.success(t('access_review.recorded_toast'));
      } else if (res.code === AUTH_STEP_UP_REQUIRED) {
        setRecordError('step_cancelled');
      } else if (res.code === 'ACCESS_REVIEW_LIST_CHANGED') {
        setRecordError('list_changed');
      } else {
        setRecordError('failed');
      }
    } catch (err) {
      logError('Recording an access review did not complete', err);
      setRecordError('failed');
    } finally {
      setRecording(false);
    }
  };

  const nextDue = (() => {
    if (!data?.last_review || data.due) return null;
    const date = new Date(data.last_review.at);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + DUE_AFTER_DAYS);
    return date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('access_review.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('access_review.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading || recording}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !data ? (
        <div role="status" aria-busy="true" aria-label={t('access_review.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !data ? (
        <LoadError title={t('access_review.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-8">
          {refreshFailed ? (
            <p className="text-sm font-medium text-warning-soft-foreground" role="alert">
              {t('access_review.refresh_failed')}
            </p>
          ) : null}
          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4">
              {data.due ? (
                <CalendarClock size={22} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <CalendarCheck size={22} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-col gap-1 text-sm text-foreground">
                {data.last_review === null ? (
                  <p>{t('access_review.never')}</p>
                ) : (
                  <p data-testid="last-review">
                    {data.last_review.by_name !== null
                      ? t('access_review.last_review', { date: day(data.last_review.at), name: data.last_review.by_name })
                      : t('access_review.last_review_erased', { date: day(data.last_review.at) })}
                  </p>
                )}
                {data.due ? (
                  <p className="font-medium text-warning-soft-foreground">{t('access_review.due')}</p>
                ) : nextDue !== null ? (
                  <p data-testid="next-due">{t('access_review.not_due', { date: nextDue })}</p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <section aria-labelledby="review-now-heading">
            <h2 id="review-now-heading" className="text-xl font-semibold text-foreground">
              {t('access_review.review_now')}
            </h2>
            <p className="mb-4 mt-1 max-w-2xl text-sm text-muted">{t('access_review.review_intro')}</p>

            {accounts.length === 0 ? (
              <p className="text-sm text-muted">{t('access_review.no_accounts')}</p>
            ) : (
              <div className="flex flex-col gap-6">
                {SENIOR_LEVELS.map((level) => {
                  const atLevel = accounts.filter((a) => a.level === level);
                  if (atLevel.length === 0) return null;
                  const headingId = `review-level-heading-${level}`;

                  return (
                    <section key={level} aria-labelledby={headingId} data-testid={`review-level-${level}`}>
                      <h3 id={headingId} className="mb-2 text-lg font-semibold text-foreground">
                        {t(`senior_accounts.level.${level}`)}{' '}
                        <span className="font-normal text-muted">({atLevel.length})</span>
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {atLevel.map((account) => (
                          <li key={account.id} data-testid={`review-account-${account.id}`}>
                            <Card>
                              <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="break-words text-base font-semibold text-foreground">
                                    {account.name ?? t('senior_accounts.unnamed')}
                                  </p>
                                  <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                                    <div className="flex min-w-0 gap-1">
                                      <dt className="shrink-0">{t('senior_accounts.community')}</dt>
                                      <dd className="min-w-0 break-words font-medium text-foreground">
                                        {communityName(account.community)}
                                      </dd>
                                    </div>
                                    <div className="flex gap-1">
                                      <dt>{t('senior_accounts.last_sign_in')}</dt>
                                      <dd className="font-medium text-foreground">{day(account.last_sign_in_at)}</dd>
                                    </div>
                                  </dl>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Chip size="sm" variant="soft" color={account.two_step_on ? 'success' : 'danger'}>
                                      {account.two_step_on
                                        ? t('senior_accounts.two_step_on')
                                        : t('senior_accounts.two_step_off')}
                                    </Chip>
                                    {account.status !== 'active' ? (
                                      <Chip size="sm" variant="soft" color="warning">
                                        {t(accountStatusKey(account.status))}
                                      </Chip>
                                    ) : null}
                                  </div>
                                </div>
                                <RadioGroup
                                  aria-label={
                                    account.name
                                      ? t('access_review.decision_for', { name: account.name })
                                      : t('access_review.decision_for_unnamed', { id: account.id })
                                  }
                                  orientation="horizontal"
                                  value={decisions[account.id] ?? null}
                                  onValueChange={(value) => {
                                    if (value === 'keep' || value === 'remove') {
                                      setDecisions((prev) => ({ ...prev, [account.id]: value }));
                                      setRecordError(null);
                                    }
                                  }}
                                  isDisabled={recording}
                                  className="shrink-0"
                                >
                                  <Radio value="keep">{t('access_review.keep')}</Radio>
                                  <Radio value="remove">{t('access_review.remove')}</Radio>
                                </RadioGroup>
                              </CardBody>
                            </Card>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}

                <Card>
                  <CardBody className="flex flex-col gap-4 p-4">
                    <Textarea
                      label={t('access_review.note_label')}
                      description={t('access_review.note_hint', { max: NOTE_MAX })}
                      value={note}
                      onValueChange={setNote}
                      maxLength={NOTE_MAX}
                      isDisabled={recording}
                    />
                    <p className="-mt-2 text-sm text-muted">{t('access_review.note_no_names')}</p>
                    <p className="flex items-start gap-2 text-sm font-medium text-foreground" data-testid="nothing-changes">
                      <Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                      {t('access_review.nothing_changes')}
                    </p>
                    <p className="text-sm text-muted" aria-live="polite">
                      {t('access_review.progress', { done: decided, total: accounts.length })}
                    </p>
                    {recordError ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" role="alert">
                        <p className="text-sm font-medium text-danger">{t(`access_review.error_${recordError}`)}</p>
                        {recordError === 'list_changed' ? (
                          <Button size="sm" variant="secondary" onPress={() => void load()}>
                            {t('access_review.reload')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <Button
                        variant="primary"
                        isLoading={recording}
                        isDisabled={!canRecord}
                        onPress={() => void record()}
                      >
                        {t('access_review.record')}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </div>
            )}
          </section>

          {data.open_removals.length > 0 ? (
            <section aria-labelledby="open-removals-heading" data-testid="open-removals">
              <h2 id="open-removals-heading" className="text-xl font-semibold text-foreground">
                {t('access_review.open_title')}
              </h2>
              <p className="mb-3 mt-1 max-w-2xl text-sm text-muted">{t('access_review.open_intro')}</p>
              <ul className="flex flex-col gap-2">
                {data.open_removals.map((open) => (
                  <li key={open.id}>
                    <Card>
                      <CardBody className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="break-words font-semibold text-foreground">
                          {open.name ?? t('senior_accounts.unnamed')}
                        </p>
                        <p className="text-sm text-muted">
                          {(SENIOR_LEVELS as readonly string[]).includes(open.level)
                            ? t(`senior_accounts.level.${open.level}`)
                            : null}
                          {' · '}
                          {communityName(open.community)}
                        </p>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="review-history-heading">
            <h2 id="review-history-heading" className="mb-3 text-xl font-semibold text-foreground">
              {t('access_review.history_title')}
            </h2>
            {data.history.length === 0 ? (
              <p className="text-sm text-muted">{t('access_review.history_none')}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="review-history">
                {data.history.map((item) => (
                  <li key={item.id}>
                    <Card>
                      <CardBody className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{day(item.at)}</p>
                          <p className="text-sm text-muted">
                            {t('access_review.history_by', { name: item.by_name ?? t('access_review.erased') })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Chip size="sm" variant="soft" color="default">
                            {t('access_review.history_accounts', { count: item.account_count })}
                          </Chip>
                          <Chip size="sm" variant="soft" color={item.remove_count > 0 ? 'warning' : 'default'}>
                            {t('access_review.history_removals', { count: item.remove_count })}
                          </Chip>
                        </div>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

export default AccessReviewPage;
