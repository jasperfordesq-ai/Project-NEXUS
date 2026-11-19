// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ListChecks from 'lucide-react/icons/list-checks';
import Heart from 'lucide-react/icons/heart';
import Users from 'lucide-react/icons/users';
import Calendar from 'lucide-react/icons/calendar';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Sparkles from 'lucide-react/icons/sparkles';
import MessageSquare from 'lucide-react/icons/message-square';
import Bookmark from 'lucide-react/icons/bookmark';
import Building2 from 'lucide-react/icons/building-2';
import MapPin from 'lucide-react/icons/map-pin';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Disclosure, DisclosureTrigger, DisclosureContent, DisclosureIndicator } from '@/components/ui/Disclosure';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/Progress';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatRelativeTime, formatDateTime } from '@/lib/helpers';
import { DistanceChip } from './DistanceChip';
import { ScoreBreakdown } from './ScoreBreakdown';
import { DismissReasonPopover } from './DismissReasonPopover';
import type { DismissReason, Match, MatchModule } from '../types';
import { DEFAULT_HOT_THRESHOLD, displayScore, isSuggestion, matchDetailId, matchElementId } from '../types';

export interface MatchCardProps {
  match: Match;
  index: number;
  highlightId?: string | null;
  /** The community's "strong match" score; the page passes the server's. */
  hotThreshold?: number;
  onDismissed: (match: Match) => void;
}

const MODULE_CONFIG: Record<MatchModule, { icon: typeof ListChecks; labelKey: string; color: string; path: string }> = {
  listing: { icon: ListChecks, labelKey: 'source_listing', color: 'text-blue-700 dark:text-blue-400 bg-blue-400/10', path: '/listings' },
  // A volunteering match is an opportunity, opened by its opportunity id.
  volunteering: { icon: Heart, labelKey: 'source_volunteering', color: 'text-rose-600 dark:text-rose-400 bg-rose-400/10', path: '/volunteering/opportunities' },
  group: { icon: Users, labelKey: 'source_group', color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-400/10', path: '/groups' },
  event: { icon: Calendar, labelKey: 'source_event', color: 'text-amber-700 dark:text-amber-400 bg-amber-400/10', path: '/events' },
};

type JoinState = 'none' | 'joined' | 'requested';

function matchSourceType(match: Match): 'listing' | 'group' | null {
  if (match.module === 'listing') return 'listing';
  if (match.module === 'group') return 'group';
  return null;
}

/** When an event starts, in the reader's own date format; null when the server sent nothing usable. */
function eventStartText(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateTime(parsed, { dateStyle: 'medium', timeStyle: 'short' });
}

export function MatchCard({ match, index, highlightId, hotThreshold = DEFAULT_HOT_THRESHOLD, onDismissed }: MatchCardProps) {
  const { t } = useTranslation('matches');
  // "Offer" and "Request" as the listings pages word them.
  const { t: tListings } = useTranslation('listings');
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const toast = useToast();

  const [isDismissing, setIsDismissing] = useState(false);
  const [isDismissOpen, setIsDismissOpen] = useState(false);
  // null = not known yet. The match list does not say whether the member has
  // already saved this offer or request, so nothing is assumed: the first
  // press asks the server before it changes anything.
  const [isSaved, setIsSaved] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinState, setJoinState] = useState<JoinState>('none');

  const config = MODULE_CONFIG[match.module] ?? MODULE_CONFIG.listing;
  const Icon = config.icon;
  const detailId = matchDetailId(match);
  // No id for this module means no link at all: a card without a link is
  // better than a link to the wrong record.
  const detailPath = detailId !== undefined ? `${config.path}/${detailId}` : null;
  const sourceType = matchSourceType(match);
  const elementId = matchElementId(match);
  const isHighlighted = highlightId != null && highlightId === elementId;
  const canDismiss = sourceType != null && detailId !== undefined;
  const suggestion = isSuggestion(match);
  const score = displayScore(match.match_score);

  const reasons = Array.isArray(match.match_reasons) ? match.match_reasons : [];
  const eventStart = match.module === 'event' ? eventStartText(match.event_date) : null;
  const attendeeCount = match.module === 'event' && typeof match.attendee_count === 'number' ? match.attendee_count : 0;
  const organisationName = match.module === 'volunteering' ? match.organization_name?.trim() || null : null;
  const placeName = match.module === 'event' || match.module === 'volunteering' ? match.location?.trim() || null : null;
  const hasDetails = Boolean(eventStart || attendeeCount > 0 || organisationName || placeName);
  // The same rule as the listing page: without it the button led to a
  // redirect in a community with messages or direct messaging switched off.
  const canMessage = hasModule('messages') && hasFeature('direct_messaging');
  const showMessage = canMessage && match.module === 'listing' && match.user_id != null && detailId !== undefined;
  const showGroupActions = match.module === 'group' && detailPath !== null;
  const showSave = match.module === 'listing' && detailId !== undefined;
  const hasActions = showMessage || showGroupActions || showSave || canDismiss;

  const handleDismiss = async (reason: DismissReason) => {
    if (!sourceType || detailId === undefined) return;
    setIsDismissing(true);
    try {
      const res = await api.post(`/v2/matches/${sourceType}/${detailId}/dismiss`, { reason });
      if (res.success) {
        setIsDismissOpen(false);
        onDismissed(match);
        toast.success(t('match_hidden'));
      } else {
        toast.error(res.error || t('errors.dismiss_failed'));
      }
    } catch (err) {
      logError('MatchCard.dismiss', err);
      toast.error(t('errors.dismiss_failed'));
    }
    setIsDismissing(false);
  };

  const handleToggleSave = async () => {
    if (match.module !== 'listing' || detailId === undefined) return;
    setIsSaving(true);
    try {
      if (isSaved === null) {
        // POST /v2/bookmarks is a toggle. Pressing it blind on something the
        // member saved earlier would remove it while the button showed "saved".
        const status = await api.get<{ bookmarked?: boolean }>(
          `/v2/bookmarks/status?type=listing&id=${detailId}`,
        );
        if (!status.success || typeof status.data?.bookmarked !== 'boolean') {
          toast.error(status.error || t('errors.save_failed'));
          setIsSaving(false);
          return;
        }
        if (status.data.bookmarked) {
          setIsSaved(true);
          toast.info(t('card.already_saved'));
          setIsSaving(false);
          return;
        }
      }

      const res = await api.post<{ bookmarked?: boolean }>('/v2/bookmarks', { type: 'listing', id: detailId });
      if (res.success && typeof res.data?.bookmarked === 'boolean') {
        // The server's answer is the state — never a local guess.
        setIsSaved(res.data.bookmarked);
        toast.success(res.data.bookmarked ? t('card.saved_toast') : t('card.unsaved_toast'));
      } else {
        toast.error(res.error || t('errors.save_failed'));
      }
    } catch (err) {
      logError('MatchCard.bookmark', err);
      toast.error(t('errors.save_failed'));
    }
    setIsSaving(false);
  };

  const handleJoinGroup = async () => {
    if (match.module !== 'group' || detailId === undefined) return;
    setIsJoining(true);
    try {
      const res = await api.post<{ status?: string }>(`/v2/groups/${detailId}/join`, {});
      if (res.success) {
        // A group that approves its members answers "pending": the member has
        // asked to join, and is not in the group yet.
        if (res.data?.status === 'pending') {
          setJoinState('requested');
          toast.success(t('card.join_requested_toast'));
        } else {
          setJoinState('joined');
          toast.success(t('card.joined'));
        }
      } else {
        toast.error(res.error || t('errors.join_failed'));
      }
    } catch (err) {
      logError('MatchCard.joinGroup', err);
      toast.error(t('errors.join_failed'));
    }
    setIsJoining(false);
  };

  const summary: ReactNode = (
    <>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h3 className="font-semibold text-theme-primary truncate group-hover:text-accent transition-colors">
          {match.title}
        </h3>
        <Chip size="sm" variant="flat" className={config.color}>
          {/* Every listing card used to carry the same words, "Offer or
              request", though the server says which it is. */}
          {match.module === 'listing' && (match.type === 'offer' || match.type === 'request')
            ? tListings(match.type)
            : t(config.labelKey)}
        </Chip>
        {match.module === 'listing' && match.category_name ? (
          <Chip size="sm" variant="flat" className="bg-theme-elevated text-theme-secondary">
            {match.category_name}
          </Chip>
        ) : null}
        {suggestion && (
          <Chip size="sm" variant="flat" startContent={<Sparkles className="w-3 h-3" aria-hidden="true" />}>
            {t('card.suggested')}
          </Chip>
        )}
        <DistanceChip distanceKm={match.distance_km} isRemote={match.is_remote} />
        {match.is_mutual && (
          <Chip size="sm" variant="flat" color="success" startContent={<ArrowLeftRight className="w-3 h-3" aria-hidden="true" />}>
            {t('card.mutual')}
          </Chip>
        )}
        {joinState === 'joined' && (
          <Chip size="sm" variant="flat" color="success">
            {t('card.joined')}
          </Chip>
        )}
        {joinState === 'requested' && (
          <Chip size="sm" variant="flat" color="warning">
            {t('card.join_requested')}
          </Chip>
        )}
      </div>

      {match.description && (
        <p className="text-sm text-theme-secondary line-clamp-2 mb-2">
          {match.description}
        </p>
      )}

      {hasDetails && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-subtle mb-2">
          {eventStart && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {eventStart}
            </span>
          )}
          {organisationName && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
              {organisationName}
            </span>
          )}
          {placeName && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              {placeName}
            </span>
          )}
          {attendeeCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              {t('card.attendees', { count: attendeeCount })}
            </span>
          )}
        </div>
      )}

      {/* Match score bar — a suggestion has no score worth showing */}
      {!suggestion && (
        <div className="flex items-center gap-2 mb-2">
          <Progress
            value={score}
            size="sm"
            color={score >= hotThreshold ? 'success' : score >= 60 ? 'warning' : 'default'}
            className="max-w-[120px]"
            aria-label={t('score_label', { score })}
          />
          <span className="text-xs text-theme-subtle">{t('score_percent', { score })}</span>
        </div>
      )}
    </>
  );

  return (
    <motion.div
      id={elementId}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ delay: index * 0.05 }}
    >
      <GlassCard
        className={`p-4 hover:border-[var(--color-primary)]/20 transition-all group ${
          match.is_mutual ? 'ring-1 ring-success/40' : ''
        } ${isHighlighted ? 'motion-safe:animate-pulse ring-2 ring-[var(--color-primary)]' : ''}`}
      >
        <div className="flex items-start gap-4">
          {/* Module icon, with the score on top when there is one. The same
              figure follows as text, so the badge is hidden from screen readers. */}
          <div className="flex-shrink-0 relative">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${config.color}`}>
              <Icon className="w-6 h-6" aria-hidden="true" />
            </div>
            {!suggestion && (
              <div
                className={`absolute -top-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  score >= hotThreshold
                    ? 'bg-emerald-700 text-white'
                    : score >= 60
                    ? 'bg-amber-700 text-white'
                    : 'bg-surface-tertiary text-foreground'
                }`}
                aria-hidden="true"
              >
                {score}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Only the summary is the link. The reasons below hold a button
                ("+2 more"), and a button must never sit inside a link. */}
            {detailPath ? (
              <Link to={tenantPath(detailPath)} className="block">
                {summary}
              </Link>
            ) : (
              <div>{summary}</div>
            )}

            {/* Explanation or reasons */}
            {match.explanation ? (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-theme-elevated mb-2">
                <Sparkles className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm text-theme-secondary">{match.explanation}</p>
                  {match.explanation_source === 'ai' && (
                    <p className="text-[11px] text-theme-subtle mt-1">{t('explanation.ai_caption')}</p>
                  )}
                </div>
              </div>
            ) : reasons.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2 items-center">
                {reasons.slice(0, 3).map((reason, i) => (
                  <Chip key={i} size="sm" variant="dot" color="primary" className="text-xs">
                    {reason}
                  </Chip>
                ))}
                {reasons.length > 3 && (
                  <Disclosure className="inline-flex">
                    <DisclosureTrigger className="inline-flex items-center gap-1 text-xs text-theme-subtle bg-theme-hover rounded-full px-2 py-0.5 hover:text-theme-primary transition-colors">
                      {t('reasons_more', { count: reasons.length - 3 })}
                      <DisclosureIndicator />
                    </DisclosureTrigger>
                    <DisclosureContent>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {reasons.slice(3).map((reason, i) => (
                          <Chip key={i} size="sm" variant="dot" color="primary" className="text-xs">
                            {reason}
                          </Chip>
                        ))}
                      </div>
                    </DisclosureContent>
                  </Disclosure>
                )}
              </div>
            ) : null}

            {/* Matched member & time */}
            {(match.user_name || match.created_at) && (
              <div className="flex items-center gap-3 text-xs text-theme-subtle">
                {match.user_name && (
                  <div className="flex items-center gap-1.5">
                    <Avatar
                      src={resolveAvatarUrl(match.avatar_url)}
                      name={match.user_name}
                      size="sm"
                      className="w-4 h-4"
                    />
                    <span>{match.user_name}</span>
                  </div>
                )}
                {match.created_at && <span>{formatRelativeTime(match.created_at)}</span>}
              </div>
            )}

            {/* Score breakdown */}
            {!suggestion && match.score_breakdown && <ScoreBreakdown breakdown={match.score_breakdown} />}

            {/* Actions row — left out when a card has nothing to press */}
            {hasActions && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-theme-default">
              {showMessage && (
                <Button
                  as={Link}
                  to={tenantPath(`/messages?to=${match.user_id}&listing=${detailId}`)}
                  size="sm"
                  className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                  startContent={<MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {t('card.message')}
                </Button>
              )}

              {showGroupActions && detailPath && (
                <>
                  <Button as={Link} to={tenantPath(detailPath)} size="sm" variant="secondary" className="bg-theme-elevated text-theme-primary">
                    {t('card.view_group')}
                  </Button>
                  {joinState === 'none' && (
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                      isLoading={isJoining}
                      onPress={handleJoinGroup}
                    >
                      {t('card.join')}
                    </Button>
                  )}
                </>
              )}

              {showSave && (
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  aria-label={t('card.save')}
                  aria-pressed={isSaved === true}
                  isLoading={isSaving}
                  onPress={handleToggleSave}
                  className={isSaved ? 'text-[var(--color-warning)]' : 'text-theme-subtle hover:text-theme-primary'}
                >
                  <Bookmark className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true" />
                </Button>
              )}

              {canDismiss && (
                <div className="ml-auto">
                  <DismissReasonPopover
                    isOpen={isDismissOpen}
                    onOpenChange={setIsDismissOpen}
                    onDismiss={handleDismiss}
                    isLoading={isDismissing}
                  />
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export default MatchCard;
