// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PeopleYouMayKnowWidget - Shows member suggestions in the sidebar
 */

import { Link } from 'react-router-dom';

import UserPlus from 'lucide-react/icons/user-plus';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';
import { resolveAvatarUrl } from '@/lib/helpers';

export interface SuggestedMember {
  id: number;
  name: string;
  avatar_url?: string;
  location?: string;
  is_online?: boolean;
}

interface PeopleYouMayKnowWidgetProps {
  members: SuggestedMember[];
}

export function PeopleYouMayKnowWidget({ members }: PeopleYouMayKnowWidgetProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');

  if (members.length === 0) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {t('sidebar.people.title')}
          </h3>
        </div>
        <Link
          to={tenantPath('/members')}
          className="text-xs text-accent hover:text-accent transition-colors duration-200"
        >
          {t('sidebar.people.see_all')}
        </Link>
      </div>

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors duration-200"
          >
            <Link to={tenantPath(`/profile/${member.id}`)} className="relative flex-shrink-0">
              <Avatar
                src={resolveAvatarUrl(member.avatar_url)}
                name={member.name}
                size="sm"
              />
              {member.is_online && (
                <span
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--glass-bg)] bg-emerald-500"
                  aria-label={t('sidebar.friends.online')}
                />
              )}
            </Link>
            <Link to={tenantPath(`/profile/${member.id}`)} className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {member.name}
              </p>
              {member.location && (
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {member.location}
                </p>
              )}
            </Link>
            <Button
              as={Link}
              to={tenantPath(`/profile/${member.id}`)}
              size="sm"
              variant="flat"
              className="text-xs text-accent-soft-foreground bg-accent/10 hover:bg-accent/20 flex-shrink-0"
            >
              {t('sidebar.people.view')}
            </Button>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

export default PeopleYouMayKnowWidget;
