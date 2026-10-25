// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Members' support needs — who told us they would like extra support, what
 * that changes for them on the platform, and whether a broker has seen it.
 *
 * This was the third of four tabs on the old safeguarding dashboard. It is now
 * a page of its own because it is the list a broker most needs to see: an
 * answer can switch on protections (vetted-only contact, coordinator
 * approval, limited messaging, held matches) that change the member's day.
 *
 * "Not yet seen" is the default view. Marking a member as seen records it
 * against the member (POST …/member-preferences/{id}/seen), which also clears
 * them from the sidebar badge and the broker dashboard tile until they next
 * change their answers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Avatar, Button, Card, CardBody, CardHeader, Chip, SearchField, Spinner } from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import { AdminEmbedAutoRefresh, useAdminEmbed } from '@/admin/components/AdminEmbedContext';
import { BrokerSkeleton } from '@/broker/components/BrokerSkeleton';
import {
  PROTECTION_KEYS,
  SafeguardingFilterBar,
  requestBadgeRefresh,
  type MemberSupportNeed,
} from './safeguardingShared';

type ShowFilter = 'unseen' | 'all';

interface MemberSupportNeedsPanelProps {
  /**
   * Open the member's record. The broker panel passes its panel-wide member
   * window (`useMemberWindow().open`), so names behave like every other
   * member name in that panel; the admin panel passes nothing and names stay
   * plain text.
   */
  onOpenMember?: (userId: number) => void;
}

/** Members needing a look first, then anyone whose answers change something, newest first. */
function sortEntries(a: MemberSupportNeed, b: MemberSupportNeed): number {
  const needs = Number(Boolean(b.needs_review)) - Number(Boolean(a.needs_review));
  if (needs !== 0) return needs;
  const protects = Number((b.protections?.length ?? 0) > 0) - Number((a.protections?.length ?? 0) > 0);
  if (protects !== 0) return protects;
  return new Date(b.consent_given_at).getTime() - new Date(a.consent_given_at).getTime();
}

export function MemberSupportNeedsPanel({ onOpenMember }: MemberSupportNeedsPanelProps) {
  const { t } = useTranslation('admin_safeguarding');
  const toast = useToast();
  const { embedded } = useAdminEmbed();
  const [searchParams, setSearchParams] = useSearchParams();
  const show: ShowFilter = searchParams.get('show') === 'all' ? 'all' : 'unseen';
  // Safeguarding alerts about one member link here with ?user=<id>; show
  // just that member, whatever the filter, until "Show everyone" is pressed.
  const rawUser = Number(searchParams.get('user'));
  const focusUserId = Number.isInteger(rawUser) && rawUser > 0 ? rawUser : null;

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [entries, setEntries] = useState<MemberSupportNeed[]>([]);
  const [search, setSearch] = useState('');
  const [markingId, setMarkingId] = useState<number | null>(null);

  // `quiet` keeps the current list on screen while a fresh one loads — used
  // by the broker panel's auto-refresh (after a change in the member window,
  // after "Mark as seen", on tab focus) so the list never flashes.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get<MemberSupportNeed[]>('/v2/admin/safeguarding/member-preferences');
      if (res.success) {
        setEntries(Array.isArray(res.data) ? res.data : []);
        setFailed(false);
      } else {
        // F-542: a refused or failed load must not read as "no members".
        setEntries([]);
        setFailed(true);
      }
    } catch (err) {
      logError('MemberSupportNeedsPanel.load', err);
      setEntries([]);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setShow = useCallback(
    (next: ShowFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') params.set('show', 'all');
          else params.delete('show');
          params.delete('user');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const markSeen = useCallback(
    async (entry: MemberSupportNeed) => {
      setMarkingId(entry.user_id);
      try {
        const res = await api.post<{ seen_at: string | null; seen_by_name: string | null }>(
          `/v2/admin/safeguarding/member-preferences/${entry.user_id}/seen`,
        );
        if (res.success) {
          setEntries((prev) =>
            prev.map((e) =>
              e.user_id === entry.user_id
                ? {
                    ...e,
                    needs_review: false,
                    seen_at: res.data?.seen_at ?? new Date().toISOString(),
                    seen_by_name: res.data?.seen_by_name ?? null,
                  }
                : e,
            ),
          );
          toast.success(t('safeguarding.support_needs.marked_seen_toast', { name: entry.user_name }));
          requestBadgeRefresh();
        } else {
          // admin-i18n-ignore: localized server message — AdminSafeguardingController
          toast.error(res.error || t('safeguarding.support_needs.mark_seen_failed'));
        }
      } catch (err) {
        logError('MemberSupportNeedsPanel.markSeen', err);
        toast.error(t('safeguarding.support_needs.mark_seen_failed'));
      }
      setMarkingId(null);
    },
    [toast, t],
  );

  const unseenCount = useMemo(() => entries.filter((e) => e.needs_review).length, [entries]);

  const visible = useMemo(() => {
    if (focusUserId !== null) return entries.filter((e) => e.user_id === focusUserId);
    let list = show === 'unseen' ? entries.filter((e) => e.needs_review) : entries;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) => e.user_name.toLowerCase().includes(q));
    return [...list].sort(sortEntries);
  }, [entries, show, search, focusUserId]);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch gap-4">
        <p className="text-sm text-muted">{t('safeguarding.support_needs.intro')}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SafeguardingFilterBar<ShowFilter>
            label={t('safeguarding.support_needs.filter_label')}
            value={show}
            onChange={setShow}
            options={[
              { key: 'unseen', label: t('safeguarding.support_needs.filter_unseen'), count: unseenCount },
              { key: 'all', label: t('safeguarding.support_needs.filter_all'), count: entries.length },
            ]}
          />
          <div className="flex items-center gap-2">
            <SearchField
              aria-label={t('safeguarding.support_needs.search_label')}
              placeholder={t('safeguarding.support_needs.search_placeholder')}
              value={search}
              onValueChange={setSearch}
              size="sm"
              className="w-56 max-w-full"
            />
            <Button variant="secondary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => void load()}>
              {t('safeguarding.refresh')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <AdminEmbedAutoRefresh reload={() => void load(true)} />
        {loading ? (
          embedded ? (
            <BrokerSkeleton variant="table" count={4} />
          ) : (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          )
        ) : failed ? (
          <div role="alert" className="py-8 text-center text-danger">
            <Shield size={40} className="mx-auto mb-2 opacity-40" aria-hidden="true" />
            <p>{t('safeguarding.member_preferences_load_failed')}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-muted">
            <Shield size={40} className="mx-auto mb-2 opacity-40" aria-hidden="true" />
            <p>{t('safeguarding.no_member_preferences')}</p>
            <p className="mt-1 text-sm">{t('safeguarding.no_member_preferences_desc')}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-muted">
            <CheckCircle size={40} className="mx-auto mb-2 text-success opacity-60" aria-hidden="true" />
            <p>
              {search.trim()
                ? t('safeguarding.support_needs.no_search_results')
                : t('safeguarding.support_needs.all_seen')}
            </p>
            {show === 'unseen' && !search.trim() && (
              <Button className="mt-3" size="sm" variant="secondary" onPress={() => setShow('all')}>
                {t('safeguarding.support_needs.show_everyone')}
              </Button>
            )}
          </div>
        ) : (
          <>
          {focusUserId !== null && (
            <div className="mb-2 flex justify-end">
              <Button size="sm" variant="secondary" onPress={() => setShow('all')}>
                {t('safeguarding.support_needs.show_everyone')}
              </Button>
            </div>
          )}
          <ul className="divide-y divide-divider" aria-label={t('safeguarding.support_needs.list_label')}>
            {visible.map((entry) => {
              const protections = (entry.protections ?? []).filter((p) =>
                (PROTECTION_KEYS as readonly string[]).includes(p),
              );
              const chosen = entry.options.filter((o) => !o.is_declination);
              return (
                <li key={entry.user_id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Avatar src={entry.user_avatar || undefined} name={entry.user_name} size="sm" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        {onOpenMember ? (
                          <button
                            type="button"
                            className="inline max-w-full truncate text-left font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            onClick={() => onOpenMember(entry.user_id)}
                          >
                            {entry.user_name}
                          </button>
                        ) : (
                          <span className="font-semibold">{entry.user_name}</span>
                        )}
                        <p className="text-xs text-muted">
                          {t('safeguarding.support_needs.answered', { when: formatRelativeTime(entry.consent_given_at) })}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">
                          {t('safeguarding.support_needs.what_they_told_us')}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {entry.is_declination_only || chosen.length === 0 ? (
                            <Chip size="sm" variant="soft" color="default">{t('safeguarding.declined_none_apply')}</Chip>
                          ) : (
                            chosen.map((opt) => (
                              <Chip key={opt.option_key} size="sm" variant="soft" color="accent">{opt.label}</Chip>
                            ))
                          )}
                        </div>
                      </div>

                      {!entry.is_declination_only && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted">
                            {t('safeguarding.support_needs.what_this_changes')}
                          </p>
                          {protections.length === 0 ? (
                            <p className="mt-1 text-sm text-muted">{t('safeguarding.support_needs.nothing_changes')}</p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {protections.map((p) => (
                                <li key={p} className="text-sm">
                                  <span className="font-medium">{t(`safeguarding.trigger_labels.${p}`)}</span>
                                  <span className="text-muted"> — {t(`safeguarding.help.triggers.effects.${p}`)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                    {entry.needs_review ? (
                      <>
                        <Chip size="sm" variant="soft" color="warning">{t('safeguarding.support_needs.status_unseen')}</Chip>
                        <Button
                          size="sm"
                          startContent={<Eye size={14} />}
                          isLoading={markingId === entry.user_id}
                          onPress={() => void markSeen(entry)}
                          aria-label={t('safeguarding.support_needs.mark_seen_aria', { name: entry.user_name })}
                        >
                          {t('safeguarding.support_needs.mark_seen')}
                        </Button>
                      </>
                    ) : entry.seen_at ? (
                      <Chip size="sm" variant="soft" color="success" startContent={<CheckCircle size={12} />}>
                        {entry.seen_by_name
                          ? t('safeguarding.support_needs.seen_by', { name: entry.seen_by_name, when: formatRelativeTime(entry.seen_at) })
                          : t('safeguarding.support_needs.seen', { when: formatRelativeTime(entry.seen_at) })}
                      </Chip>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default MemberSupportNeedsPanel;
