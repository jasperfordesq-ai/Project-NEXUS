// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgTeamTab — the organisation's team on its dashboard (gap D7, 7 Oct 2026).
 *
 * Owners add people from the community, change roles and remove members.
 * Organisation admins see the team but cannot change it. The server decides
 * both (GET …/members returns `can_manage`) and enforces the safeguards: the
 * person who registered the organisation and your own place cannot be
 * changed, and the last owner cannot be removed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import UserPlus from 'lucide-react/icons/user-plus';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';

type Role = 'owner' | 'admin' | 'member';
const ROLES: readonly Role[] = ['owner', 'admin', 'member'];
const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

interface TeamMember {
  user_id: number;
  name: string;
  avatar_url: string | null;
  role: Role;
  is_creator: boolean;
}

interface SearchResult {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  organization_name?: string | null;
  avatar_url?: string | null;
}

const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 300;

const resultName = (r: SearchResult) =>
  r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.organization_name || `#${r.id}`;

interface OrgTeamTabProps {
  orgId: number;
}

export default function OrgTeamTab({ orgId }: OrgTeamTabProps) {
  const { t } = useTranslation('volunteering');
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [newRole, setNewRole] = useState<Role>('member');
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await api.get<{ items?: TeamMember[]; can_manage?: boolean }>(`/v2/volunteering/organisations/${orgId}/members`);
      if (res.success && res.data) {
        setMembers(Array.isArray(res.data.items) ? res.data.items : []);
        setCanManage(Boolean(res.data.can_manage));
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      logError('Failed to load organisation team', err);
      setLoadFailed(true);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // `/v2/users/search` answers `{ items: [...] }` once the client has unwrapped `data`.
  const handleQuery = (value: string) => {
    setQuery(value);
    setPicked(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = value.trim();
    if (trimmed.length < SEARCH_MIN) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ items?: SearchResult[] } | SearchResult[]>(`/v2/users/search?q=${encodeURIComponent(trimmed)}&limit=8`);
        const items = res.success && res.data ? (Array.isArray(res.data) ? res.data : res.data.items ?? []) : [];
        const onTeam = new Set(members.map((m) => m.user_id));
        setResults(items.filter((r) => !onTeam.has(r.id)));
      } catch (err) {
        logError('Organisation team member search failed', err);
        setResults([]);
      }
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
  };

  const fail = (error?: string) => toast.error(error || t('org_team.failed'));

  const handleAdd = async () => {
    if (!picked) return;
    setAdding(true);
    try {
      const res = await api.post(`/v2/volunteering/organisations/${orgId}/members`, { user_id: picked.id, role: newRole });
      if (res.success) {
        toast.success(t('org_team.added', { name: resultName(picked) }));
        setPicked(null);
        setQuery('');
        setResults([]);
        setNewRole('member');
        await load();
      } else {
        fail(res.error);
      }
    } catch {
      fail();
    }
    setAdding(false);
  };

  const handleRole = async (member: TeamMember, role: Role) => {
    if (role === member.role) return;
    setBusyId(member.user_id);
    try {
      const res = await api.put(`/v2/volunteering/organisations/${orgId}/members/${member.user_id}`, { role });
      if (res.success) {
        toast.success(t('org_team.role_changed', { name: member.name }));
        await load();
      } else {
        fail(res.error);
      }
    } catch {
      fail();
    }
    setBusyId(null);
  };

  const handleRemove = async (member: TeamMember) => {
    setBusyId(member.user_id);
    try {
      const res = await api.delete(`/v2/volunteering/organisations/${orgId}/members/${member.user_id}`);
      if (res.success) {
        toast.success(t('org_team.removed', { name: member.name }));
        setConfirmRemoveId(null);
        await load();
      } else {
        fail(res.error);
      }
    } catch {
      fail();
    }
    setBusyId(null);
  };

  if (loading && members.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="mb-3 text-theme-muted">{t('org_team.load_failed')}</p>
        <Button variant="tertiary" onPress={() => void load()}>{t('try_again')}</Button>
      </GlassCard>
    );
  }

  const ownId = user?.id != null ? Number(user.id) : null;

  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <h2 className="text-lg font-semibold text-theme-primary">{t('org_team.title')}</h2>
        <p className="mt-1 text-sm text-theme-muted">{canManage ? t('org_team.intro_owner') : t('org_team.intro_viewer')}</p>
      </GlassCard>

      {canManage && (
        <GlassCard className="p-5">
          <h3 className="mb-3 font-semibold text-theme-primary">{t('org_team.add_title')}</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                type="search"
                label={t('org_team.search_label')}
                placeholder={t('org_team.search_placeholder')}
                value={picked ? resultName(picked) : query}
                onValueChange={handleQuery}
                autoComplete="off"
              />
            </div>
            <Select
              label={t('org_team.role_label')}
              className="sm:max-w-[180px]"
              selectedKeys={[newRole]}
              onChange={(e) => { if (isRole(e.target.value)) setNewRole(e.target.value); }}
            >
              {ROLES.map((role) => <SelectItem key={role} id={role}>{t(`org_team.roles.${role}`)}</SelectItem>)}
            </Select>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              startContent={<UserPlus className="h-4 w-4" aria-hidden="true" />}
              isDisabled={!picked}
              isLoading={adding}
              onPress={() => void handleAdd()}
            >
              {t('org_team.add')}
            </Button>
          </div>
          {!picked && query.trim().length >= SEARCH_MIN && (
            <div className="mt-3" aria-live="polite">
              {searching ? (
                <p className="text-sm text-theme-muted">{t('org_team.searching')}</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-theme-muted">{t('org_team.no_results')}</p>
              ) : (
                <ul className="space-y-1" aria-label={t('org_team.results_label')}>
                  {results.map((r) => (
                    <li key={r.id}>
                      <Button
                        variant="tertiary"
                        className="w-full justify-start"
                        startContent={<span aria-hidden="true"><Avatar src={resolveAvatarUrl(r.avatar_url ?? null)} name={resultName(r)} size="sm" /></span>}
                        onPress={() => { setPicked(r); setResults([]); }}
                      >
                        {t('org_team.choose', { name: resultName(r) })}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-theme-muted">{t('org_team.role_help')}</p>
        </GlassCard>
      )}

      {members.length === 0 ? (
        <GlassCard className="flex flex-col items-center p-8 text-theme-muted">
          <Users className="mb-2 h-10 w-10" aria-hidden="true" />
          <p>{t('org_team.empty')}</p>
        </GlassCard>
      ) : (
        <ul className="space-y-2" aria-busy={loading || undefined}>
          {members.map((m) => {
            const isSelf = ownId !== null && ownId === m.user_id;
            const locked = m.is_creator || isSelf;
            const busy = busyId === m.user_id;
            return (
              <li key={m.user_id}>
                <GlassCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={resolveAvatarUrl(m.avatar_url)} name={m.name} size="md" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-theme-primary">{m.name}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {!canManage && <Chip size="sm" variant="soft">{t(`org_team.roles.${m.role}`)}</Chip>}
                        {m.is_creator && <Chip size="sm" variant="secondary">{t('org_team.creator')}</Chip>}
                        {isSelf && <Chip size="sm" variant="secondary">{t('org_team.you')}</Chip>}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    confirmRemoveId === m.user_id ? (
                      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('org_team.remove_confirm', { name: m.name })}>
                        <span className="text-sm text-theme-muted">{t('org_team.remove_confirm', { name: m.name })}</span>
                        <Button size="sm" color="danger" isLoading={busy} onPress={() => void handleRemove(m)}>
                          {t('org_team.remove_yes')}
                        </Button>
                        <Button size="sm" variant="tertiary" isDisabled={busy} onPress={() => setConfirmRemoveId(null)}>
                          {t('org_team.remove_no')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select
                          size="sm"
                          aria-label={t('org_team.role_for', { name: m.name })}
                          className="w-40"
                          selectedKeys={[m.role]}
                          isDisabled={locked || busy}
                          onChange={(e) => { if (isRole(e.target.value)) void handleRole(m, e.target.value); }}
                        >
                          {ROLES.map((role) => <SelectItem key={role} id={role}>{t(`org_team.roles.${role}`)}</SelectItem>)}
                        </Select>
                        <Button
                          size="sm"
                          variant="tertiary"
                          aria-label={t('org_team.remove_named', { name: m.name })}
                          isDisabled={locked || busy}
                          onPress={() => setConfirmRemoveId(m.user_id)}
                        >
                          {t('org_team.remove')}
                        </Button>
                      </div>
                    )
                  )}
                </GlassCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
