// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
/**
 * Group Members Tab
 * Lists group members with admin role management (promote/demote/remove).
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import Users from 'lucide-react/icons/users';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Shield from 'lucide-react/icons/shield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserX from 'lucide-react/icons/user-x';
import Search from 'lucide-react/icons/search';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { resolveAvatarUrl, formatDateValue, getFormattingLocale } from '@/lib/helpers';
import type { User } from '@/types/api';

export interface GroupMember extends Omit<User, 'role'> {
  role?: 'member' | 'admin' | 'owner';
  joined_at?: string;
  capabilities?: {
    can_change_role: boolean;
    can_remove: boolean;
  };
}

interface GroupMembersTabProps {
  members: GroupMember[];
  membersLoading: boolean;
  membersLoadingMore?: boolean;
  membersHasMore?: boolean;
  userIsAdmin: boolean;
  currentUserId?: number;
  groupOwnerId?: number;
  groupAdminIds?: number[];
  updatingMember: number | null;
  onUpdateMemberRole: (userId: number, role: 'member' | 'admin') => void;
  onRemoveMember: (userId: number) => void;
  onSearchMembers?: (query: string) => void;
  onLoadMoreMembers?: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const MAX_SEARCH_LENGTH = 100;

export function GroupMembersTab({
  members,
  membersLoading,
  membersLoadingMore = false,
  membersHasMore = false,
  userIsAdmin,
  currentUserId,
  groupOwnerId,
  groupAdminIds,
  updatingMember,
  onUpdateMemberRole,
  onRemoveMember,
  onSearchMembers,
  onLoadMoreMembers,
}: GroupMembersTabProps) {
  const { t } = useTranslation('groups');
  const { tenantPath } = useTenant();
  const [search, setSearch] = useState('');
  const lastSubmittedSearchRef = useRef('');
  const normalizedSearch = search.trim();

  useEffect(() => {
    if (!onSearchMembers || normalizedSearch === lastSubmittedSearchRef.current) return;
    const timeout = window.setTimeout(() => {
      lastSubmittedSearchRef.current = normalizedSearch;
      onSearchMembers(normalizedSearch);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [normalizedSearch, onSearchMembers]);

  return (
    <GlassCard className="p-4 sm:p-6">
      {membersLoading && members.length === 0 && !normalizedSearch ? (
        <div role="status" aria-busy="true" className="flex justify-center py-10" aria-label={t('detail.members_loading_aria')}>
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <SearchField
            aria-label={t('detail.members_search_aria')}
            className="w-full sm:max-w-md"
            maxLength={MAX_SEARCH_LENGTH}
            isClearable={Boolean(search)}
            placeholder={t('detail.members_search_placeholder')}
            startContent={<Search className="h-4 w-4" aria-hidden="true" />}
            value={search}
            onValueChange={setSearch}
          />

          {membersLoading ? (
            <div role="status" aria-busy="true" className="flex justify-center py-10" aria-label={t('detail.members_loading_aria')}>
              <Spinner size="lg" />
            </div>
          ) : members.length > 0 ? (
            <>
              <p className="text-sm text-theme-subtle" aria-live="polite">
                {t(normalizedSearch ? 'detail.members_search_results_summary' : 'detail.members_loaded_summary', {
                  count: members.length,
                  formattedCount: members.length.toLocaleString(getFormattingLocale()),
                })}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                {members.map((member) => {
                  const memberIsOwner = member.role === 'owner' || member.id === groupOwnerId;
                  const memberIsAdmin = member.role === 'admin' || (groupAdminIds?.includes(member.id) ?? false) || memberIsOwner;
                  const fallbackCanManage = userIsAdmin && !memberIsOwner && member.id !== currentUserId;
                  const canChangeRole = member.capabilities?.can_change_role ?? fallbackCanManage;
                  const canRemove = member.capabilities?.can_remove ?? fallbackCanManage;
                  const canManage = canChangeRole || canRemove;
                  const joinedLabel = member.joined_at ? formatDateValue(member.joined_at) : null;

                  return (
                    <div key={member.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-theme-elevated p-3 transition-colors hover:bg-theme-hover sm:gap-4 sm:p-4">
                      <Link to={tenantPath(`/profile/${member.id}`)} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                        <Avatar
                          src={resolveAvatarUrl(member.avatar_url || member.avatar)}
                          name={member.name}
                          size="md"
                          className="ring-2 ring-white/20 flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-theme-primary truncate">{member.name}</p>
                          {member.tagline && (
                            <p className="text-sm text-theme-subtle truncate">{member.tagline}</p>
                          )}
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                            {memberIsOwner && (
                              <Chip size="sm" variant="flat" className="bg-amber-500/20 text-amber-600 dark:text-amber-400" startContent={<ShieldCheck className="w-3 h-3" aria-hidden="true" />}>
                                {t('detail.member_owner')}
                              </Chip>
                            )}
                            {memberIsAdmin && !memberIsOwner && (
                              <Chip size="sm" variant="flat" className="bg-accent/20 text-accent-soft-foreground" startContent={<Shield className="w-3 h-3" aria-hidden="true" />}>
                                {t('detail.member_admin')}
                              </Chip>
                            )}
                            {joinedLabel && (
                              <span className="truncate text-xs text-theme-subtle">
                                {t('detail.member_joined', { date: joinedLabel })}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>

                      {canManage && (
                        <Dropdown>
                          <DropdownTrigger>
                            <Button
                              isIconOnly
                              variant="light"
                              size="sm"
                              className="min-h-11 min-w-11"
                              aria-label={t('detail.manage_member_aria', { name: member.name })}
                              isLoading={updatingMember === member.id}
                            >
                              <MoreVertical className="w-4 h-4" aria-hidden="true" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu aria-label={t('detail.member_actions_aria')}>
                            {canChangeRole && (memberIsAdmin ? (
                              <DropdownItem
                                key="demote" id="demote"
                                startContent={<Users className="w-4 h-4" aria-hidden="true" />}
                                onPress={() => onUpdateMemberRole(member.id, 'member')}
                              >
                                {t('detail.demote_to_member')}
                              </DropdownItem>
                            ) : (
                              <DropdownItem
                                key="promote" id="promote"
                                startContent={<Shield className="w-4 h-4" aria-hidden="true" />}
                                onPress={() => onUpdateMemberRole(member.id, 'admin')}
                              >
                                {t('detail.promote_to_admin')}
                              </DropdownItem>
                            ))}
                            {canRemove && (
                              <DropdownItem
                                key="remove" id="remove"
                                className="text-danger"
                                color="danger"
                                startContent={<UserX className="w-4 h-4" aria-hidden="true" />}
                                onPress={() => onRemoveMember(member.id)}
                              >
                                {t('detail.remove_from_group')}
                              </DropdownItem>
                            )}
                          </DropdownMenu>
                        </Dropdown>
                      )}
                    </div>
                  );
                })}
              </div>
              {membersHasMore && onLoadMoreMembers && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="flat"
                    className="min-h-11 w-full sm:w-auto"
                    isDisabled={membersLoadingMore}
                    isLoading={membersLoadingMore}
                    onPress={onLoadMoreMembers}
                  >
                    {t('detail.members_load_more')}
                  </Button>
                </div>
              )}
            </>
          ) : normalizedSearch ? (
            <EmptyState
              icon={<Search className="h-12 w-12" aria-hidden="true" />}
              title={t('detail.members_search_no_results_title')}
              description={t('detail.members_search_no_results_desc', { query: normalizedSearch })}
            />
          ) : (
            <EmptyState
              icon={<Users className="w-12 h-12" aria-hidden="true" />}
              title={t('detail.no_members_title')}
              description={t('detail.no_members_desc')}
            />
          )}
        </div>
      )}
    </GlassCard>
  );
}
