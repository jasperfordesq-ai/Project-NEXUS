// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Link } from 'react-router-dom';
import Briefcase from 'lucide-react/icons/briefcase';
import MapPin from 'lucide-react/icons/map-pin';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Heart from 'lucide-react/icons/heart';
import Timer from 'lucide-react/icons/timer';
import Globe from 'lucide-react/icons/globe';
import { useTranslation } from 'react-i18next';
import type { JobVacancy } from './JobDetailTypes';
import { TYPE_CHIP_COLORS } from './JobDetailTypes';

const TYPE_ICONS: Record<string, typeof DollarSign> = {
  paid: DollarSign,
  volunteer: Heart,
  timebank: Timer,
};

interface SimilarJobsProps {
  jobs: JobVacancy[];
  tenantPath: (path: string) => string;
}

export function SimilarJobs({ jobs, tenantPath }: SimilarJobsProps) {
  const { t } = useTranslation('jobs');

  if (jobs.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-theme-primary mb-4">{t('similar_jobs')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {jobs.map((sj) => {
          const SjTypeIcon = TYPE_ICONS[sj.type] ?? Briefcase;
          return (
            <Link key={sj.id} to={tenantPath(`/jobs/${sj.id}`)}>
              <GlassCard className="p-4 hover:scale-[1.02] transition-transform motion-reduce:transition-none motion-reduce:hover:scale-100 h-full">
                <div className="flex items-center gap-2 mb-2">
                  {/* The same tile as the jobs list's cards, in the community colour. */}
                  <div data-testid="similar-job-tile" className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-companion/20 flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-4 h-4 text-accent" aria-hidden="true" />
                  </div>
                  <h3 className="font-medium text-theme-primary text-sm line-clamp-2">{sj.title}</h3>
                </div>
                <p className="text-xs text-theme-muted mb-2">
                  {sj.organization?.name ?? sj.creator?.name}
                </p>
                <div className="flex flex-wrap gap-1">
                  <Chip size="sm" variant="tertiary" color={TYPE_CHIP_COLORS[sj.type] ?? 'default'} className="text-xs">
                    <span className="flex items-center gap-0.5">
                      <SjTypeIcon className="w-3 h-3" aria-hidden="true" />
                      {t(`type.${sj.type}`)}
                    </span>
                  </Chip>
                  {sj.is_remote ? (
                    <Chip size="sm" variant="tertiary" color="accent" className="text-xs">
                      <span className="flex items-center gap-0.5">
                        <Globe className="w-3 h-3" aria-hidden="true" />
                        {t('remote')}
                      </span>
                    </Chip>
                  ) : sj.location ? (
                    <Chip size="sm" variant="tertiary" color="default" className="text-xs">
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {sj.location}
                      </span>
                    </Chip>
                  ) : null}
                </div>
              </GlassCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
