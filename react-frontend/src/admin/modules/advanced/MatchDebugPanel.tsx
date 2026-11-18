// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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
import { formatPercentValue, formatUnit, resolveAvatarUrl } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { adminUsers } from '../../api/adminApi';
import { useTranslation } from 'react-i18next';

/**
 * Match Debug Panel (platform team)
 *
 * Shows a member's top matches with the score breakdown the engine really
 * produced, from GET /v2/matches/all?user_id=&debug=true:
 *  - current scoring method: three pillars (relevance, feasibility, trust),
 *    the signals inside each, and the points added or taken off afterwards;
 *  - older scoring method: the six flat component scores;
 *  - group / volunteering / event suggestions: no breakdown exists.
 *
 * Until November 2026 this page read field names the server never sent
 * (`_debug_scores`, `reasons`, `matched_user`, `category`, `source_type`),
 * so every card showed a title, a score and "No debug scores available".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types — the shape CrossModuleMatchingService::getAllMatches() sends
// ─────────────────────────────────────────────────────────────────────────────

/** Every pillar and signal value is 0–1; adjustments are points on the 0–100 score. */
interface ScoreBreakdown {
  pillars?: Record<string, number>;
  signals?: Record<string, Record<string, number> | number>;
  adjustments?: Record<string, number>;
}

interface DebugMatch {
  module?: string;
  listing_id?: number;
  group_id?: number;
  organization_id?: number;
  event_id?: number;
  match_score: number;
  match_type?: string;
  title?: string | null;
  description?: string | null;
  match_reasons?: string[] | null;
  user_name?: string | null;
  avatar_url?: string | null;
  category_name?: string | null;
  distance_km?: number | null;
  matched_listing?: string | null;
  score_breakdown?: ScoreBreakdown | null;
  /** Older scoring method only: six flat 0–1 component scores. */
  match_breakdown?: unknown;
}

interface UserSearchResult {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score helpers
// ─────────────────────────────────────────────────────────────────────────────

type ProgressColor = 'success' | 'warning' | 'danger' | 'default';

function scoreColor(value: number): ProgressColor {
  if (value >= 70) return 'success';
  if (value >= 40) return 'warning';
  if (value >= 1) return 'danger';
  return 'default';
}

function scoreTextClass(value: number): string {
  if (value >= 70) return 'text-success';
  if (value >= 40) return 'text-warning';
  if (value >= 1) return 'text-danger';
  return 'text-muted';
}

/** The kinds of suggestion the server sends (its `module` field). */
const SOURCE_I18N_KEYS: Record<string, string> = {
  listing: 'source_listing',
  volunteering: 'source_volunteering',
  group: 'source_group',
  event: 'source_event',
};

const SOURCE_COLORS: Record<string, 'primary' | 'warning' | 'danger' | 'success'> = {
  listing: 'primary',
  volunteering: 'danger',
  group: 'success',
  event: 'warning',
};

/** Current scoring method: three pillars and the signals inside each. */
const PILLARS: Array<{ key: string; i18nKey: string; signals: Array<{ key: string; i18nKey: string }> }> = [
  {
    key: 'relevance',
    i18nKey: 'pillar_relevance',
    signals: [
      { key: 'category', i18nKey: 'score_category' },
      { key: 'skill', i18nKey: 'score_skill' },
      { key: 'semantic', i18nKey: 'signal_semantic' },
    ],
  },
  {
    key: 'feasibility',
    i18nKey: 'pillar_feasibility',
    signals: [
      { key: 'proximity', i18nKey: 'score_proximity' },
      { key: 'availability', i18nKey: 'signal_availability' },
      { key: 'activity', i18nKey: 'signal_activity' },
    ],
  },
  {
    key: 'trust',
    i18nKey: 'pillar_trust',
    signals: [
      { key: 'reviews', i18nKey: 'signal_reviews' },
      { key: 'trust_tier', i18nKey: 'signal_trust_tier' },
      { key: 'completion', i18nKey: 'signal_completion' },
    ],
  },
];

/** Older scoring method: six flat component scores. */
const LEGACY_COMPONENTS: Array<{ key: string; i18nKey: string }> = [
  { key: 'category', i18nKey: 'score_category' },
  { key: 'skill', i18nKey: 'score_skill' },
  { key: 'proximity', i18nKey: 'score_proximity' },
  { key: 'freshness', i18nKey: 'score_freshness' },
  { key: 'reciprocity', i18nKey: 'score_reciprocity' },
  { key: 'quality', i18nKey: 'score_quality' },
];

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 0–1 → a whole percentage. */
function toPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** The current method's breakdown, when the match carries one. */
function pillarBreakdown(match: DebugMatch): ScoreBreakdown | null {
  const breakdown = match.score_breakdown;
  if (!breakdown || typeof breakdown !== 'object' || !breakdown.pillars) return null;
  return PILLARS.some(({ key }) => isNumber(breakdown.pillars?.[key])) ? breakdown : null;
}

/** The older method's six flat scores, when that is what the match carries. */
function legacyBreakdown(match: DebugMatch): Record<string, number> | null {
  const raw = match.match_breakdown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const flat: Record<string, number> = {};
  for (const { key } of LEGACY_COMPONENTS) {
    const value = (raw as Record<string, unknown>)[key];
    if (isNumber(value)) flat[key] = value;
  }
  return Object.keys(flat).length > 0 ? flat : null;
}

function matchKey(match: DebugMatch, index: number): string {
  const id = match.listing_id ?? match.group_id ?? match.event_id ?? match.organization_id ?? 'x';
  return `${match.module ?? 'match'}-${id}-${index}`;
}

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
      const res = await api.get(`/v2/matches/all?limit=10&debug=true&user_id=${user.id}`);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        const items: DebugMatch[] = Array.isArray(payload)
          ? (payload as DebugMatch[])
          : ((payload as { matches?: DebugMatch[] }).matches ?? []);
        setMatches(items);
        setTotal(items.length);
      } else if (!res.success) {
        // A refusal (not on the platform team, member not in this community)
        // must not read as "this member has no matches".
        toast.error(t('failed_to_load_matches_for_this_user'));
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

  // ─── One labelled score bar (value is 0–100) ─────────────────────────────

  const scoreBar = (key: string, label: string, value: number, strong = false) => (
    <div key={key}>
      <div className="flex justify-between text-xs mb-1">
        <span className={strong ? 'font-semibold text-foreground' : 'text-muted'}>{label}</span>
        <span className={`font-medium tabular-nums ${scoreTextClass(value)}`}>{value}</span>
      </div>
      <Progress
        value={value}
        color={scoreColor(value)}
        size="sm"
        aria-label={t('component_match_score_aria', { component: label, score: value })}
      />
    </div>
  );

  const renderBreakdown = (match: DebugMatch) => {
    // Group, volunteering and event suggestions are not scored by the
    // listing engine, so there is nothing to break down.
    if (match.module && match.module !== 'listing') {
      return <p className="text-xs text-muted italic">{t('no_breakdown_for_module')}</p>;
    }

    const breakdown = pillarBreakdown(match);
    if (breakdown) {
      const adjustments = Object.entries(breakdown.adjustments ?? {}).filter(([, points]) => isNumber(points));
      return (
        <div>
          <p className="text-xs font-medium text-muted mb-2">{t('score_breakdown')}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {PILLARS.map(({ key, i18nKey, signals }) => {
              const pillarValue = breakdown.pillars?.[key];
              const pillarSignals = breakdown.signals?.[key];
              return (
                <div key={key} className="space-y-3 rounded-lg border border-divider p-3">
                  {isNumber(pillarValue) && scoreBar(key, t(i18nKey), toPercent(pillarValue), true)}
                  {typeof pillarSignals === 'object' && pillarSignals !== null && signals.map((signal) => {
                    const value = pillarSignals[signal.key];
                    return isNumber(value)
                      ? scoreBar(`${key}-${signal.key}`, t(signal.i18nKey), toPercent(value))
                      : null;
                  })}
                </div>
              );
            })}
          </div>
          {adjustments.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted mb-2">{t('adjustments_title')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {adjustments.map(([name, points]) => (
                  <li key={name} className="rounded-full border border-divider px-2.5 py-1 text-xs">
                    {/* The engine's own name for the adjustment, as stored. */}
                    <code className="text-muted">{name}</code>{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {points > 0 ? '+' : ''}{points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    const legacy = legacyBreakdown(match);
    if (legacy) {
      return (
        <div>
          <p className="text-xs font-medium text-muted mb-2">{t('score_breakdown')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {LEGACY_COMPONENTS.map(({ key, i18nKey }) => {
              const value = legacy[key];
              return value === undefined ? null : scoreBar(key, t(i18nKey), toPercent(value));
            })}
          </div>
        </div>
      );
    }

    return <p className="text-xs text-muted italic">{t('no_debug_scores')}</p>;
  };

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

          {matches.map((match, index) => {
            const moduleName = match.module ?? 'listing';
            const sourceKey = SOURCE_I18N_KEYS[moduleName];
            const score = Math.round(match.match_score);
            const reasons = Array.isArray(match.match_reasons) ? match.match_reasons : [];

            return (
              <Card key={matchKey(match, index)}>
                <CardHeader className="flex items-start justify-between gap-4 pb-2">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Rank badge */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent-soft-foreground">
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-foreground truncate">{match.title}</span>
                        <Chip size="sm" variant="soft" color={SOURCE_COLORS[moduleName] ?? 'primary'}>
                          {/* An unknown kind is shown as the server named it. */}
                          {sourceKey ? t(sourceKey) : moduleName}
                        </Chip>
                        {match.category_name && (
                          <Chip size="sm" variant="soft" className="text-xs">
                            {t('match_category.value', { category: match.category_name })}
                          </Chip>
                        )}
                        {isNumber(match.distance_km) && (
                          <Chip size="sm" variant="soft" className="text-xs tabular-nums">
                            {formatUnit(match.distance_km, 'kilometer', { maximumFractionDigits: 1 })}
                          </Chip>
                        )}
                      </div>

                      {match.description && (
                        <p className="text-xs text-muted line-clamp-2 mb-2">
                          {match.description}
                        </p>
                      )}

                      {/* The member who posted it */}
                      {match.user_name && (
                        <div className="flex items-center gap-2 mb-2">
                          <Avatar
                            src={resolveAvatarUrl(match.avatar_url)}
                            name={match.user_name}
                            size="sm"
                            className="w-5 h-5"
                          />
                          <span className="text-xs text-muted">{match.user_name}</span>
                        </div>
                      )}

                      {match.matched_listing && (
                        <p className="text-xs text-muted">
                          {t('matched_against', { title: match.matched_listing })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Overall score */}
                  <div className="shrink-0 text-right">
                    <div className={`text-2xl font-bold tabular-nums ${
                      score >= 70 ? 'text-success'
                      : score >= 40 ? 'text-warning'
                      : 'text-danger'
                    }`}>
                      {score}
                    </div>
                    <div className="text-xs text-muted">{t('score_out_of', { maximum: 100 })}</div>
                  </div>
                </CardHeader>

                <CardBody className="pt-0 space-y-4">
                  {/* Overall score bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted mb-1">
                      <span className="font-medium">{t('overall_match_score')}</span>
                      <span>{formatPercentValue(score)}</span>
                    </div>
                    <Progress
                      value={score}
                      color={scoreColor(score)}
                      size="md"
                      aria-label={t('overall_match_score_aria', { score })}
                    />
                  </div>

                  {renderBreakdown(match)}

                  {/* Match reasons */}
                  {reasons.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted mb-2">{t('match_reasons')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {reasons.map((reason) => (
                          <Chip key={reason} size="sm" variant="soft" className="text-xs">
                            {reason}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MatchDebugPanel;
