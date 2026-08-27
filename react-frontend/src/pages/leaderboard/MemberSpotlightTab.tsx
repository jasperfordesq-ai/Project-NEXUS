// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
/**
 * MemberSpotlightTab — daily rotating spotlight of active community members.
 *
 * Randomly features active members rather than always surfacing top earners.
 * Uses date-seeded rotation so the same members show all day.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Sparkles from 'lucide-react/icons/sparkles';
import ChevronRight from 'lucide-react/icons/chevron-right';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';

interface SpotlightMember {
  id: number;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  bio: string | null;
  member_since: string | null;
  level: number;
  xp: number;
  recent_activity: string;
}

export default function MemberSpotlightTab() {
  const { t } = useTranslation('gamification');
  const { tenantPath } = useTenant();
  const [members, setMembers] = useState<SpotlightMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        setError(false);
        const res = await api.get<SpotlightMember[]>('/v2/gamification/member-spotlight?limit=6');
        if (res.success && res.data) {
          setMembers(Array.isArray(res.data) ? res.data : []);
        } else if (!res.success) {
          // A failed request resolves { success:false } without throwing. Without an
          // error state the empty "No Spotlight Yet" card rendered, hiding the failure
          // as "there are no members" — track it and show a distinct error instead.
          logError('MemberSpotlightTab', res.error || 'Failed to load spotlight');
          setError(true);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          logError('MemberSpotlightTab', err);
          setError(true);
        }
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <GlassCard key={i} className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div>
                <Skeleton className="h-4 w-24 mb-1 rounded" />
                <Skeleton className="h-3 w-16 rounded" />
              </div>
            </div>
            <Skeleton className="h-12 w-full rounded" />
          </GlassCard>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="text-danger-500">{t('spotlight.load_error')}</p>
      </GlassCard>
    );
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles className="w-12 h-12" />}
        title={t('spotlight.empty_title')}
        description={t('spotlight.empty_description')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-[var(--color-warning)]" />
        <p className="text-sm text-muted">
          {t('spotlight.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {members.map((member, i) => (
          <motion.div
            key={member.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Link to={tenantPath(`/members/${member.id}`)}>
                <GlassCard className="p-6 hover:ring-1 hover:ring-accent/30 transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar
                    src={resolveAvatarUrl(member.avatar_url)}
                    name={resolveUserDisplayName(member)}
                    size="lg"
                    className="ring-2 ring-amber-500/30"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">
                      {member.first_name} {member.last_name}
                    </p>
                    {member.member_since && (
                       <p className="text-xs text-muted">
                        {t('spotlight.member_since')} {member.member_since}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-accent font-medium">{member.recent_activity}</span>
                  {member.xp > 0 && (
                    <span className="text-muted text-xs">
                      {t('achievements.xp_value', { xp: member.xp.toLocaleString(getFormattingLocale()) })}
                    </span>
                  )}
                </div>

                {member.bio && (
                  <p className="text-xs text-muted mt-2 line-clamp-2">
                    {member.bio}
                  </p>
                )}
              </GlassCard>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
