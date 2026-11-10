// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * QuickActionsWidget - Shows quick action buttons in the sidebar
 */

import { kindColour } from '@/components/feed/feedTypeColours';
import { Link } from 'react-router-dom';import Plus from 'lucide-react/icons/plus';
import CalendarDays from 'lucide-react/icons/calendar-days';
import BarChart3 from 'lucide-react/icons/chart-column';
import Target from 'lucide-react/icons/target';
import UsersRound from 'lucide-react/icons/users-round';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAuth, useTenant } from '@/contexts';
import { canCreateEvents } from '@/lib/access';

export function QuickActionsWidget() {
  const { isAuthenticated, user } = useAuth();
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const { t } = useTranslation('feed');

  if (!isAuthenticated) return null;

  const secondaryActions = [
    {
      label: t('sidebar.actions.host_event'),
      icon: CalendarDays,
      path: '/events/create',
      tone: kindColour('event').label,
      feature: 'events' as const,
    },
    {
      label: t('sidebar.actions.create_poll'),
      icon: BarChart3,
      path: '/polls',
      tone: kindColour('poll').label,
      feature: 'polls' as const,
    },
    {
      label: t('sidebar.actions.set_goal'),
      icon: Target,
      path: '/goals',
      tone: kindColour('goal').label,
      feature: 'goals' as const,
    },
    {
      label: t('sidebar.actions.groups'),
      icon: UsersRound,
      path: '/groups',
      tone: kindColour('group').label,
      feature: 'groups' as const,
    },
  ];

  const enabledActions = secondaryActions.filter((action) => {
    if (!hasFeature(action.feature)) return false;
    // The events feature can be on while creation is restricted to brokers/admins.
    if (action.path === '/events/create' && !canCreateEvents(user)) return false;
    return true;
  });

  return (
    <GlassCard className="p-4">
      {/* Primary CTA */}
      {hasModule('listings') && <Button
        as={Link}
        to={tenantPath('/listings/create')}
        className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white shadow-lg shadow-accent/25 hover:shadow-accent/40 transition-shadow font-medium"
        startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
      >
        {t('sidebar.actions.create_listing')}
      </Button>}

      {/* Secondary actions grid */}
      {enabledActions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {enabledActions.map((action) => (
            <Link
              key={action.path}
              to={tenantPath(action.path)}
              // Each action in its kind's colour, the same as in the feed and
              // everywhere else (pale tint, deep text; axe: the old -500 text on a
              // -500/10 tint was 2.2–4.5:1 at 11px).
              className={`flex flex-col items-center gap-1.5 p-3 rounded-lg ${action.tone} transition-[filter] duration-200 hover:brightness-95 dark:hover:brightness-125`}
            >
              <action.icon className="w-4 h-4" aria-hidden="true" />
              <span className="text-[11px] font-medium">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

export default QuickActionsWidget;
