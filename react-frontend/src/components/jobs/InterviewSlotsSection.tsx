// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { GlassCard } from '@/components/ui/GlassCard';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { useTranslation } from 'react-i18next';

interface InterviewSlotsSectionProps {
  isOwner: boolean;
  hasApplied: boolean;
}

export function InterviewSlotsSection({ isOwner, hasApplied }: InterviewSlotsSectionProps) {
  const { t } = useTranslation('jobs');

  if (!isOwner && !hasApplied) return null;

  if (isOwner) {
    return (
      <div id="interview-slots-section" className="mt-6">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div data-testid="interview-slots-tile" className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/20 to-companion/20 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-theme-primary">{t('self_scheduling.title')}</h3>
              <p className="text-sm text-theme-muted">{t('self_scheduling.employer_no_slots')}</p>
            </div>
          </div>
          <p className="text-sm text-theme-muted">
            {t('self_scheduling.manage_slots')} &mdash; {t('self_scheduling.candidate_pick')}
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div id="interview-slots-candidate-section" className="mt-6">
      <GlassCard className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div data-testid="interview-slots-tile" className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/20 to-companion/20 flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-accent" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-theme-primary">{t('self_scheduling.title')}</h3>
        </div>
        <p className="text-sm text-theme-muted">{t('self_scheduling.candidate_pick')}</p>
      </GlassCard>
    </div>
  );
}
