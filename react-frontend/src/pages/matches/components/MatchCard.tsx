// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
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
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import { DistanceChip } from './DistanceChip';
import { ScoreBreakdown } from './ScoreBreakdown';
import { DismissReasonPopover } from './DismissReasonPopover';
import type { DismissReason, Match, MatchModule } from '../types';
import { matchElementId } from '../types';

export interface MatchCardProps {
  match: Match;
  index: number;
  highlightId?: string | null;
  onDismissed: (match: Match) => void;
}

const MODULE_CONFIG: Record<MatchModule, { icon: typeof ListChecks; labelKey: string; color: string; path: string }> = {
  listing: { icon: ListChecks, labelKey: 'source_listing', color: 'text-blue-700 dark:text-blue-400 bg-blue-400/10', path: '/listings' },
  volunteering: { icon: Heart, labelKey: 'source_volunteering', color: 'text-rose-600 dark:text-rose-400 bg-rose-400/10', path: '/volunteering/opportunities' },
  group: { icon: Users, labelKey: 'source_group', color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-400/10', path: '/groups' },
  event: { icon: Calendar, labelKey: 'source_event', color: 'text-amber-700 dark:text-amber-400 bg-amber-400/10', path: '/events' },
};

function matchDetailId(match: Match): number | undefined {
  return match.listing_id ?? match.group_id ?? match.organization_id ?? match.event_id;
}

function matchSourceType(match: Match): 'listing' | 'group' | null {
  if (match.module === 'listing') return 'listing';
  if (match.module === 'group') return 'group';
  return null;
}

export function MatchCard({ match, index, highlightId, onDismissed }: MatchCardProps) {
  const { t } = useTranslation('matches');
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [isDismissing, setIsDismissing] = useState(false);
  const [isDismissOpen, setIsDismissOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  const config = MODULE_CONFIG[match.module] ?? MODULE_CONFIG.listing;
  const Icon = config.icon;
  const detailId = matchDetailId(match);
  const detailPath = detailId != null ? `${config.path}/${detailId}` : config.path;
  const sourceType = matchSourceType(match);
  const elementId = matchElementId(match);
  const isHighlighted = highlightId != null && highlightId === elementId;
  const canDismiss = sourceType != null && detailId != null;

  const reasons = Array.isArray(match.match_reasons) ? match.match_reasons : [];

  const handleDismiss = async (reason: DismissReason) => {
    if (!sourceType || detailId == null) return;
    setIsDismissing(true);
    try {
      const res = await api.post(`/v2/matches/${sourceType}/${detailId}/dismiss`, { reason });
      if (res.success) {
        setIsDismissOpen(false);
        onDismissed(match);
        toast.success(t('match_hidden'));
      } else {
        toast.error(res.error || t('load_failed'));
      }
    } catch (err) {
      logError('MatchCard.dismiss', err);
      toast.error(t('load_failed'));
    }
    setIsDismissing(false);
  };

  const handleToggleSave = async () => {
    if (match.module !== 'listing' || detailId == null) return;
    setIsSaving(true);
    const next = !isSaved;
    try {
      const res = await api.post('/v2/bookmarks', { type: 'listing', id: detailId });
      if (res.success) {
        setIsSaved(next);
      } else {
        toast.error(res.error || t('load_failed'));
      }
    } catch (err) {
      logError('MatchCard.bookmark', err);
      toast.error(t('load_failed'));
    }
    setIsSaving(false);
  };

  const handleJoinGroup = async () => {
    if (match.module !== 'group' || detailId == null) return;
    setIsJoining(true);
    try {
      const res = await api.post(`/v2/groups/${detailId}/join`, {});
      if (res.success) {
        setHasJoined(true);
        toast.success(t('card.joined'));
      } else {
        toast.error(res.error || t('load_failed'));
      }
    } catch (err) {
      logError('MatchCard.joinGroup', err);
      toast.error(t('load_failed'));
    }
    setIsJoining(false);
  };

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
        } ${isHighlighted ? 'animate-pulse ring-2 ring-[var(--color-primary)]' : ''}`}
      >
        <div className="flex items-start gap-4">
          {/* Score badge */}
          <div className="flex-shrink-0 relative">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${config.color}`}>
              <Icon className="w-6 h-6" aria-hidden="true" />
            </div>
            <div
              className={`absolute -top-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                match.match_score >= 80
                  ? 'bg-emerald-500 text-white'
                  : match.match_score >= 60
                  ? 'bg-amber-500 text-white'
                  : 'bg-surface-tertiary text-foreground'
              }`}
              aria-label={t('score_label', { score: match.match_score })}
            >
              {match.match_score}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <Link to={tenantPath(detailPath)} className="block">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-theme-primary truncate group-hover:text-accent transition-colors">
                  {match.title}
                </h3>
                <Chip size="sm" variant="flat" className={config.color}>
                  {t(config.labelKey)}
                </Chip>
                <DistanceChip distanceKm={match.distance_km} isRemote={match.is_remote} />
                {match.is_mutual && (
                  <Chip size="sm" variant="flat" color="success" startContent={<ArrowLeftRight className="w-3 h-3" aria-hidden="true" />}>
                    {t('card.mutual')}
                  </Chip>
                )}
                {hasJoined && (
                  <Chip size="sm" variant="flat" color="success">
                    {t('card.joined')}
                  </Chip>
                )}
              </div>

              {match.description && (
                <p className="text-sm text-theme-secondary line-clamp-2 mb-2">
                  {match.description}
                </p>
              )}

              {/* Match score bar */}
              <div className="flex items-center gap-2 mb-2">
                <Progress
                  value={match.match_score}
                  size="sm"
                  color={match.match_score >= 80 ? 'success' : match.match_score >= 60 ? 'warning' : 'default'}
                  className="max-w-[120px]"
                  aria-label={t('score_label', { score: match.match_score })}
                />
                <span className="text-xs text-theme-subtle">{t('score_percent', { score: match.match_score })}</span>
              </div>

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

              {/* Matched user & time */}
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
            </Link>

            {/* Score breakdown */}
            {match.score_breakdown && <ScoreBreakdown breakdown={match.score_breakdown} />}

            {/* Actions row */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-theme-default">
              {match.module === 'listing' && match.user_id != null && detailId != null && (
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

              {match.module === 'group' && detailId != null && (
                <>
                  <Button as={Link} to={tenantPath(detailPath)} size="sm" variant="secondary" className="bg-theme-elevated text-theme-primary">
                    {t('card.view_group')}
                  </Button>
                  {!hasJoined && (
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

              {match.module === 'listing' && (
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  aria-label={t('card.save')}
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
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export default MatchCard;
