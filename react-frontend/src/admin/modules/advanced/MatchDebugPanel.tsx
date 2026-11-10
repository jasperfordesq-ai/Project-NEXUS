import { Card, CardBody, CardHeader, Chip, Input, Spinner, Button, Progress, Avatar } from '@/components/ui';
import { useState, useCallback, useRef } from 'react';

import Target from 'lucide-react/icons/target';
import Search from 'lucide-react/icons/search';
import User from 'lucide-react/icons/user';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatPercentValue, resolveAvatarUrl } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { adminUsers } from '../../api/adminApi';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Match Debug Panel
 * Admin tool to inspect match score breakdowns for any user.
 * Shows top matches with per-component score bars (category, skill, * proximity, freshness, reciprocity, quality).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DebugScores {
  category: number;
  skill: number;
  proximity: number;
  freshness: number;
  reciprocity: number;
  quality: number;
}

interface MatchedUser {
  id: number;
  name: string;
  avatar_url?: string | null;
}

interface DebugMatch {
  id: number;
  source_type: 'listing' | 'job' | 'volunteering' | 'group';
  source_id: number;
  match_score: number;
  title: string;
  description?: string;
  reasons: string[];
  matched_user?: MatchedUser | null;
  matched_at: string;
  category?: string | null;
  _debug_scores?: DebugScores;
}

interface UserSearchResult {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score colour helper
// ─────────────────────────────────────────────────────────────────────────────

type ProgressColor = 'success' | 'warning' | 'danger' | 'default';

function scoreColor(value: number): ProgressColor {
  if (value >= 70) return 'success';
  if (value >= 40) return 'warning';
  if (value >= 1) return 'danger';
  return 'default';
}

const SOURCE_I18N_KEYS: Record<string, string> = {
  listing: 'source_listing',
  job: 'source_job',
  volunteering: 'source_volunteering',
  group: 'source_group',
};

const SCORE_COMPONENTS: Array<{ key: keyof DebugScores; i18nKey: string }> = [
  { key: 'category', i18nKey: 'score_category' },
  { key: 'skill', i18nKey: 'score_skill' },
  { key: 'proximity', i18nKey: 'score_proximity' },
  { key: 'freshness', i18nKey: 'score_freshness' },
  { key: 'reciprocity', i18nKey: 'score_reciprocity' },
  { key: 'quality', i18nKey: 'score_quality' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MatchDebugPanel() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  const { t: tAdmin } = useTranslation('admin_advanced');
  usePageTitle(tNav('advanced'));
  const toast = useToast();

  // User search state
  const [searchQuery, setSearchQuery] = useState('');
  const [userResults, setUserResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Match results state
  const [matches, setMatches] = useState<DebugMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // ─── User search with debounce ───────────────────────────────────────────

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setShowDropdown(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value.trim() || value.trim().length < 2) {
      setUserResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await adminUsers.list({ search: value, limit: 8 } as Record<string, unknown>);
        if (res.success && res.data) {
          const data = res.data as unknown;
          const items: UserSearchResult[] = Array.isArray(data)
            ? (data as UserSearchResult[])
            : ((data as { data?: UserSearchResult[] }).data ?? []);
          setUserResults(items);
          setShowDropdown(items.length > 0);
        }
      } catch {
        // silently fail — dropdown is non-critical
      } finally {
        setSearchLoading(false);
      }
    }, 350);
  }, []);

  // ─── Select a user and load their matches ───────────────────────────────

  const selectUser = useCallback(async (user: UserSearchResult) => {
    setSelectedUser(user);
    setSearchQuery(user.name);
    setShowDropdown(false);
    setUserResults([]);
    setMatchesLoading(true);
    setMatches([]);
    setTotal(0);

    try {
      // Try the admin debug endpoint first, fall back to standard matches endpoint
      const res = await api.get(`/v2/matches/all?limit=10&debug=true&user_id=${user.id}`);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        const items: DebugMatch[] = Array.isArray(payload)
          ? (payload as DebugMatch[])
          : ((payload as { matches?: DebugMatch[] }).matches ?? []);
        setMatches(items);
        setTotal(items.length);
      }
    } catch {
      toast.error(t('failed_to_load_matches_for_this_user'));
    } finally {
      setMatchesLoading(false);
    }
  }, [t, toast])


  // ─── Reload for current user ─────────────────────────────────────────────

  const handleReload = useCallback(() => {
    if (selectedUser) {
      selectUser(selectedUser);
    }
  }, [selectedUser, selectUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('match_debug_panel_title')}
        description={t('match_debug_panel_desc')}
        actions={
          selectedUser ? (
            <Button
              onPress={handleReload}
              isDisabled={matchesLoading}
              variant="tertiary"
              className="flex items-center gap-2"
              aria-label={t('label_reload_matches')}
              startContent={<RefreshCw className={`w-4 h-4 ${matchesLoading ? 'animate-spin' : ''}`} />}
            >
              {t('reload')}
            </Button>
          ) : undefined
        }
      />

      {/* User search card */}
      <Card>
        <CardHeader className="flex gap-3 items-center">
          <div className="p-2 rounded-xl bg-accent/10">
            <Target className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t('select_a_user')}</p>
            <p className="text-xs text-muted">{t('select_a_user_desc')}</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="relative max-w-md">
            <Input type="search" name="admin-search" autoComplete="off"
              value={searchQuery}
              onValueChange={handleSearchChange}
              placeholder={t('placeholder_search_users_by_name_or_email')}
              aria-label={t('label_search_users')}
              startContent={
                searchLoading
                  ? <span role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="inline-flex"><Spinner size="sm" /></span>
                  : <Search className="w-4 h-4 text-muted" />
              }
              isClearable
              onClear={() => {
                setSearchQuery('');
                setUserResults([]);
                setShowDropdown(false);
                setSelectedUser(null);
                setMatches([]);
                setTotal(0);
              }}
            />

            {/* Dropdown results */}
            {showDropdown && userResults.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-overlay border border-divider rounded-xl shadow-lg overflow-hidden">
                {userResults.map((user) => (
                  <Button
                    key={user.id}
                    onPress={() => selectUser(user)}
                    variant="tertiary"
                    className="w-full flex items-center gap-3 px-4 py-3 justify-start min-h-12 rounded-none"
                  >
                    <Avatar
                      src={resolveAvatarUrl(user.avatar_url)}
                      name={user.name}
                      size="sm"
                    />
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                      <p className="text-xs text-muted truncate">{user.email}</p>
                    </div>
                    <span className="ml-auto text-xs text-muted shrink-0">#{user.id}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Selected user pill */}
          {selectedUser && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-muted">{t('inspecting')}</span>
              <div className="flex items-center gap-2 bg-accent/10 rounded-full px-3 py-1">
                <Avatar
                  src={resolveAvatarUrl(selectedUser.avatar_url)}
                  name={selectedUser.name}
                  size="sm"
                  className="w-5 h-5"
                />
                <span className="text-sm font-medium text-accent">{selectedUser.name}</span>
                <span className="text-xs text-accent/70">#{selectedUser.id}</span>
              </div>
              {total > 0 && (
                <Chip size="sm" variant="soft">
                  {t('match_count', { count: total })}
                </Chip>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Loading state */}
      {matchesLoading && (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-muted">{t('loading_match_scores')}</p>
          </div>
        </div>
      )}

      {/* Empty state when user selected but no matches */}
      {!matchesLoading && selectedUser && matches.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="p-4 rounded-full bg-surface-secondary">
                <Sparkles className="w-8 h-8 text-muted" />
              </div>
              <p className="font-semibold text-foreground">{t('no_matches_found')}</p>
              <p className="text-sm text-muted max-w-sm">
                {t('no_matches_desc')}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Prompt when no user selected */}
      {!matchesLoading && !selectedUser && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="p-4 rounded-full bg-surface-secondary">
                <User className="w-8 h-8 text-muted" />
              </div>
              <p className="font-semibold text-foreground">{t('no_user_selected')}</p>
              <p className="text-sm text-muted">
                {t('no_user_selected_desc')}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Match results */}
      {!matchesLoading && matches.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted font-medium">
            {t('top_matches_for_user', { count: matches.length, name: selectedUser?.name ?? '' })}
          </p>

          {matches.map((match, index) => (
            <Card key={`${match.source_type}-${match.id}-${index}`}>
              <CardHeader className="flex items-start justify-between gap-4 pb-2">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Rank badge */}
                  <div className="shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent-soft-foreground">
                    {index + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-foreground truncate">{match.title}</span>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={match.source_type === 'listing' ? 'primary'
                          : match.source_type === 'job' ? 'warning'
                          : match.source_type === 'volunteering' ? 'danger'
                          : 'success'}
                      >
                        {t(SOURCE_I18N_KEYS[match.source_type] ?? match.source_type)}
                      </Chip>
                      {match.category && (
                        <Chip size="sm" variant="soft" className="text-xs">
                          {t('match_category.value', { category: match.category })}
                        </Chip>
                      )}
                    </div>

                    {match.description && (
                      <p className="text-xs text-muted line-clamp-2 mb-2">
                        {match.description}
                      </p>
                    )}

                    {/* Matched user row */}
                    {match.matched_user && (
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar
                          src={resolveAvatarUrl(match.matched_user.avatar_url)}
                          name={match.matched_user.name}
                          size="sm"
                          className="w-5 h-5"
                        />
                        <span className="text-xs text-muted">{match.matched_user.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Overall score */}
                <div className="shrink-0 text-right">
                  <div className={`text-2xl font-bold ${
                    match.match_score >= 70 ? 'text-success'
                    : match.match_score >= 40 ? 'text-warning'
                    : 'text-danger'
                  }`}>
                    {match.match_score}
                  </div>
                  <div className="text-xs text-muted">{t('score_out_of', { maximum: 100 })}</div>
                </div>
              </CardHeader>

              <CardBody className="pt-0 space-y-4">
                {/* Overall score bar */}
                <div>
                  <div className="flex justify-between text-xs text-muted mb-1">
                    <span className="font-medium">{t('overall_match_score')}</span>
                    <span>{formatPercentValue(match.match_score)}</span>
                  </div>
                  <Progress
                    value={match.match_score}
                    color={scoreColor(match.match_score)}
                    size="md"
                    aria-label={t('overall_match_score_aria', { score: match.match_score })}
                  />
                </div>

                {/* Per-component score breakdown */}
                {match._debug_scores && (
                  <div>
                    <p className="text-xs font-medium text-muted mb-2">{t('score_breakdown')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                      {SCORE_COMPONENTS.map(({ key, i18nKey }) => {
                        const value = match._debug_scores![key] ?? 0;
                        return (
                          <div key={key}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted">{t(i18nKey)}</span>
                              <span className={`font-medium ${
                                value >= 70 ? 'text-success'
                                : value >= 40 ? 'text-warning'
                                : value >= 1 ? 'text-danger'
                                : 'text-muted'
                              }`}>
                                {value}
                              </span>
                            </div>
                            <Progress
                              value={value}
                              color={scoreColor(value)}
                              size="sm"
                              aria-label={t('component_match_score_aria', { component: t(i18nKey), score: value })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Debug scores not available notice */}
                {!match._debug_scores && (
                  <p className="text-xs text-muted italic">
                    {t('no_debug_scores')}
                  </p>
                )}

                {/* Match reasons */}
                {match.reasons && match.reasons.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted mb-2">{t('match_reasons')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {match.reasons.map((reason) => (
                        <Chip key={reason} size="sm" variant="soft" className="text-xs">
                          {reason}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default MatchDebugPanel;
