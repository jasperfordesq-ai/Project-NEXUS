// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * TopEndorsedWidget - Leaderboard of most endorsed members
 *
 * Displays a compact list of top endorsed community members.
 * Can be used as a sidebar widget or standalone section.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import Trophy from 'lucide-react/icons/trophy';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import Medal from 'lucide-react/icons/medal';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';

interface TopEndorsedMember {
  /** The key `/v2/members/top-endorsed` sends (`se.endorsed_id as user_id`). */
  user_id?: number;
  /** Legacy fallback only — the Laravel endpoint does not send `id`. */
  id?: number;
  name: string;
  avatar_url?: string;
  total_endorsements?: number;
  top_skills?: string[] | null;
}

const rankIcons = [
  <Medal key="gold" className="w-5 h-5 text-amber-500" aria-hidden="true" />,
  <Medal key="silver" className="w-5 h-5 text-gray-400" aria-hidden="true" />,
  <Medal key="bronze" className="w-5 h-5 text-amber-700" aria-hidden="true" />,
];

export function TopEndorsedWidget({ limit = 5 }: { limit?: number }) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('endorsements');
  const [members, setMembers] = useState<TopEndorsedMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTopEndorsed = async () => {
      try {
        setIsLoading(true);
        const response = await api.get<TopEndorsedMember[]>(`/v2/members/top-endorsed?limit=${limit}`);
        if (response.success && response.data) {
          setMembers(response.data);
        }
      } catch (err) {
        logError('Failed to load top endorsed members', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadTopEndorsed();
  }, [limit]);

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <div className="flex justify-center py-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          <Spinner size="sm" />
        </div>
      </GlassCard>
    );
  }

  if (members.length === 0) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-amber-500" aria-hidden="true" />
        <h3 className="font-semibold text-theme-primary text-sm">{t('most_endorsed')}</h3>
      </div>

      <div className="space-y-3">
        {members.map((member, index) => {
          const topSkills = Array.isArray(member.top_skills) ? member.top_skills : [];
          const memberId = member.user_id ?? member.id;
          if (memberId == null) return null;

          return (
            <Link
              key={memberId}
              to={tenantPath(`/profile/${memberId}`)}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-theme-hover transition-colors"
            >
              {/* Rank */}
              <div className="w-6 flex-shrink-0 flex items-center justify-center">
                {index < 3 ? (
                  rankIcons[index]
                ) : (
                  <span className="text-xs font-bold text-theme-subtle">#{index + 1}</span>
                )}
              </div>

              {/* Avatar */}
              <Avatar
                src={resolveAvatarUrl(member.avatar_url)}
                name={member.name}
                size="sm"
                className="ring-2 ring-theme-muted/20"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-theme-primary truncate">{member.name}</p>
                {topSkills.length > 0 && (
                  <p className="text-xs text-theme-subtle truncate">
                    {topSkills.slice(0, 2).join(', ')}
                  </p>
                )}
              </div>

              {/* Count */}
              <Chip
                size="sm"
                variant="flat"
                className="bg-accent/10 text-accent dark:text-accent"
                startContent={<ThumbsUp className="w-3 h-3" aria-hidden="true" />}
              >
                {member.total_endorsements ?? 0}
              </Chip>
            </Link>
          );
        })}
      </div>
    </GlassCard>
  );
}

export default TopEndorsedWidget;
