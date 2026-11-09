// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CommunityPulseWidget - Shows community stats in a compact 2x2 grid
 */

import { getFormattingLocale } from '@/lib/helpers';
import { Link } from 'react-router-dom';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Users from 'lucide-react/icons/users';
import Tag from 'lucide-react/icons/tag';
import CalendarDays from 'lucide-react/icons/calendar-days';
import UsersRound from 'lucide-react/icons/users-round';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

export interface CommunityStats {
  members: number;
  listings: number;
  events: number;
  groups: number;
}

interface CommunityPulseWidgetProps {
  stats: CommunityStats;
}

export function CommunityPulseWidget({ stats }: CommunityPulseWidgetProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');

  const items = [
    {
      icon: Users,
      count: stats.members,
      label: t('sidebar.pulse.members'),
      path: '/members',
      tone: 'bg-accent-soft text-accent-soft-foreground',
    },
    {
      icon: Tag,
      count: stats.listings,
      label: t('sidebar.pulse.listings'),
      path: '/listings',
      tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    },
    {
      icon: CalendarDays,
      count: stats.events,
      label: t('sidebar.pulse.events'),
      path: '/events',
      tone: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
    },
    {
      icon: UsersRound,
      count: stats.groups,
      label: t('sidebar.pulse.groups'),
      path: '/groups',
      tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    },
  ];

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <HeartPulse className="w-4 h-4 text-pink-500" aria-hidden="true" />
        <h3 className="font-semibold text-sm text-[var(--text-primary)]">
          {t('sidebar.pulse.title')}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <Link
            key={item.path}
            to={tenantPath(item.path)}
            // A soft tint with deep text in each figure's colour (axe: -500 and
            // muted text on the tints were 2.2–4.5:1).
            className={`flex flex-col items-center gap-1 p-3 rounded-lg ${item.tone} transition-[filter] hover:brightness-95 dark:hover:brightness-125`}
          >
            <item.icon className="w-4 h-4" aria-hidden="true" />
            <p className="text-sm font-bold">
              {(item.count ?? 0).toLocaleString(getFormattingLocale())}
            </p>
            <p className="text-[10px] font-medium">{item.label}</p>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

export default CommunityPulseWidget;
