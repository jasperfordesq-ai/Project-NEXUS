// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';

import Users from 'lucide-react/icons/users';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Archive from 'lucide-react/icons/archive';
import ArchiveRestore from 'lucide-react/icons/archive-restore';
import UserMinus from 'lucide-react/icons/user-minus';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatDate, resolveAvatarUrl } from '@/lib/helpers';
import { useTranslation } from 'react-i18next';
import { extractCollectionItems } from './extractCollectionItems';

interface Volunteer {
  id: number;
  name: string;
  avatar_url: string | null;
  email: string;
  total_hours: number;
  applications_count: number;
  applied_at: string;
  retired_at?: string | null;
}

type RosterView = 'active' | 'retired';
type RosterAction = 'retire' | 'reinstate' | 'remove';

interface OrgVolunteersTabProps {
  orgId: number;
}

export default function OrgVolunteersTab({ orgId }: OrgVolunteersTabProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<RosterView>('active');
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const cursorRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  const loadVolunteers = useCallback(async (append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);

      const params = new URLSearchParams({ per_page: '20' });
      if (view === 'retired') params.set('status', 'retired');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<Volunteer[]>(
        `/v2/volunteering/organisations/${orgId}/volunteers?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        // api.get() already unwraps { data: [...], meta: {...} } → response.data = [...], response.meta = {...}
        const items = extractCollectionItems<Volunteer>(response.data);
        const cursor = response.meta?.cursor ?? null;
        const has_more = response.meta?.has_more ?? false;
        if (append) {
          setVolunteers((prev) => [...prev, ...items]);
        } else {
          setVolunteers(items);
        }
        cursorRef.current = cursor;
        setHasMore(has_more);
      } else {
        toastRef.current.error(tRef.current('org_volunteers.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load volunteers', err);
      toastRef.current.error(tRef.current('org_volunteers.load_failed'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [orgId, view]);

  useEffect(() => {
    cursorRef.current = null;
    loadVolunteers();
    return () => { abortRef.current?.abort(); };
  }, [loadVolunteers]);

  // Retire and remove change what the volunteer can see and do, so both ask
  // first. Reinstating only undoes a retirement and goes straight through.
  async function handleAction(vol: Volunteer, action: RosterAction) {
    if (action !== 'reinstate') {
      const ok = await confirm({
        title: t(`org_volunteers.${action}_title`),
        body: t(`org_volunteers.${action}_confirm`, { name: vol.name }),
        confirmLabel: t(`org_volunteers.${action}`),
        status: action === 'remove' ? 'danger' : 'warning',
      });
      if (!ok) return;
    }

    const base = `/v2/volunteering/organisations/${orgId}/volunteers/${vol.id}`;
    setBusyId(vol.id);
    try {
      const response = action === 'remove'
        ? await api.delete(base)
        : await api.post(`${base}/${action}`, {});
      if (response.success) {
        const doneKey = action === 'retire' ? 'retired' : action === 'reinstate' ? 'reinstated' : 'removed';
        toast.success(t(`org_volunteers.${doneKey}`, { name: vol.name }));
        // Every action moves the volunteer off the list being shown.
        setVolunteers((prev) => prev.filter((v) => v.id !== vol.id));
      } else {
        toast.error(response.error || t(`org_volunteers.${action}_failed`));
      }
    } catch (err) {
      logError(`Failed to ${action} volunteer`, err);
      toast.error(t(`org_volunteers.${action}_failed`));
    } finally {
      setBusyId(null);
    }
  }

  const tabs = (
    <Tabs
      aria-label={t('org_volunteers.tabs_aria')}
      selectedKey={view}
      onSelectionChange={(key) => setView(key as RosterView)}
      variant="underlined"
      classNames={{ tabList: 'gap-1', tab: 'text-sm' }}
    >
      <Tab key="active" title={t('org_volunteers.tab_active')} />
      <Tab key="retired" title={t('org_volunteers.tab_retired')} />
    </Tabs>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {tabs}
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (volunteers.length === 0) {
    return (
      <div className="space-y-4">
        {tabs}
        <GlassCard className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 flex items-center justify-center mx-auto mb-4">
            <Users className="w-7 h-7 text-[var(--color-info)]" aria-hidden="true" />
          </div>
          <p className="text-theme-muted">{t(view === 'retired' ? 'org_volunteers.none_retired' : 'org_volunteers.none')}</p>
          <p className="text-sm text-theme-subtle mt-1">
            {t(view === 'retired' ? 'org_volunteers.none_retired_desc' : 'org_volunteers.none_desc')}
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tabs}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" aria-hidden="true" />
            {t(view === 'retired' ? 'org_volunteers.heading_retired' : 'org_volunteers.heading')}
          </h2>
          <span className="text-sm text-theme-muted">({volunteers.length}{hasMore ? '+' : ''})</span>
        </div>

        <div className="space-y-3">
          {volunteers.map((vol) => {
            const busy = busyId === vol.id;
            return (
              <div
                key={vol.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-theme-elevated border border-theme-default"
              >
                <Avatar
                  src={resolveAvatarUrl(vol.avatar_url) || undefined}
                  name={vol.name}
                  size="md"
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-theme-primary text-sm">{vol.name}</p>
                  <p className="text-xs text-theme-subtle break-all">{vol.email}</p>
                  {vol.retired_at && (
                    <p className="text-xs text-theme-muted mt-0.5">
                      {t('org_volunteers.retired_on', { date: formatDate(vol.retired_at) })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="font-semibold text-theme-primary">{t('hours_abbrev', { hours: vol.total_hours })}</p>
                    <p className="text-xs text-theme-subtle">{t('org_volunteers.hours')}</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-theme-primary">{vol.applications_count}</p>
                    <p className="text-xs text-theme-subtle">{t('org_volunteers.roles')}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-2">
                  {view === 'active' ? (
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<Archive className="w-4 h-4" aria-hidden="true" />}
                      aria-label={t('org_volunteers.retire_named', { name: vol.name })}
                      isDisabled={busyId !== null}
                      isLoading={busy}
                      onPress={() => void handleAction(vol, 'retire')}
                    >
                      {t('org_volunteers.retire')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<ArchiveRestore className="w-4 h-4" aria-hidden="true" />}
                      aria-label={t('org_volunteers.reinstate_named', { name: vol.name })}
                      isDisabled={busyId !== null}
                      isLoading={busy}
                      onPress={() => void handleAction(vol, 'reinstate')}
                    >
                      {t('org_volunteers.reinstate')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger-soft"
                    startContent={<UserMinus className="w-4 h-4" aria-hidden="true" />}
                    aria-label={t('org_volunteers.remove_named', { name: vol.name })}
                    isDisabled={busyId !== null}
                    onPress={() => void handleAction(vol, 'remove')}
                  >
                    {t('org_volunteers.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && (
          <div className="flex justify-center pt-4">
            <Button
              size="sm"
              variant="tertiary"
              startContent={isLoadingMore ? <Spinner size="sm" /> : <ChevronDown className="w-4 h-4" />}
              isDisabled={isLoadingMore}
              onPress={() => loadVolunteers(true)}
            >
              {t('load_more')}
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
