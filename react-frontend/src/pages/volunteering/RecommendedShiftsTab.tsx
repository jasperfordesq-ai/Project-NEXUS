// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RecommendedShiftsTab - Skills-based shift recommendations (V4)
 */

import { getFormattingLocale } from '@/lib/helpers';
import {
  useState,
  useEffect,
  useCallback,
  useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from '@/lib/motion';
import Sparkles from 'lucide-react/icons/sparkles';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Building2 from 'lucide-react/icons/building-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Target from 'lucide-react/icons/target';
import Zap from 'lucide-react/icons/zap';
import ExternalLink from 'lucide-react/icons/external-link';
import Settings from 'lucide-react/icons/settings';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface RecommendedShift {
  shift: {
    id: number;
    start_time: string;
    end_time: string;
    capacity: number | null;
    required_skills: string[];
  };
  opportunity: {
    id: number;
    title: string;
    location: string;
    skills_needed: string;
  };
  organization: {
    name: string;
    logo_url: string | null;
  };
  match_score: number;
  match_reasons: string[];
}

interface FlatRecommendedShift {
  shift_id: number;
  opportunity_id: number;
  title: string;
  organization_name: string;
  organization_logo_url?: string | null;
  location?: string | null;
  skills_needed?: string | null;
  start_time: string;
  end_time: string;
  capacity?: number | null;
  required_skills?: string[] | string | null;
  match_score: number;
  match_reasons?: string[];
}

type RecommendedShiftPayload = RecommendedShift | FlatRecommendedShift;

function parseSkills(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value.split(',').map((skill) => skill.trim()).filter(Boolean);
}

function normalizeRecommendedShift(item: RecommendedShiftPayload): RecommendedShift {
  if ('shift' in item) {
    return {
      ...item,
      match_reasons: item.match_reasons ?? [],
      shift: {
        ...item.shift,
        required_skills: item.shift.required_skills ?? [],
      },
    };
  }

  return {
    shift: {
      id: item.shift_id,
      start_time: item.start_time,
      end_time: item.end_time,
      capacity: item.capacity ?? null,
      required_skills: parseSkills(item.required_skills),
    },
    opportunity: {
      id: item.opportunity_id,
      title: item.title,
      location: item.location ?? '',
      skills_needed: item.skills_needed ?? '',
    },
    organization: {
      name: item.organization_name,
      logo_url: item.organization_logo_url ?? null,
    },
    match_score: item.match_score,
    match_reasons: item.match_reasons ?? [],
  };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const getMatchColor = (score: number): 'success' | 'warning' | 'primary' | 'default' => {
  if (score >= 75) return 'success';
  if (score >= 50) return 'primary';
  if (score >= 30) return 'warning';
  return 'default';
};

export function RecommendedShiftsTab() {
  const { t } = useTranslation('volunteering');
  const navigate = useNavigate();
  const { tenantPath, hasModule } = useTenant();
  const [shifts, setShifts] = useState<RecommendedShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{ shifts?: RecommendedShiftPayload[] } | RecommendedShiftPayload[]>(
        '/v2/volunteering/recommended-shifts?limit=10'
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const payload = response.data as { shifts?: RecommendedShiftPayload[] } | RecommendedShiftPayload[];
        const items = Array.isArray(payload) ? payload : (payload.shifts ?? []);
        setShifts(items.map(normalizeRecommendedShift));
      } else {
        setError(tRef.current('recommendations.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load recommended shifts', err);
      setError(tRef.current('recommendations.error_load_generic'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('recommendations.title')}</h2>
        </div>
        <Button
          size="sm"
          variant="tertiary"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={load}
          isLoading={isLoading}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            onPress={load}
          >
            {t('common.try_again')}
          </Button>
        </GlassCard>
      )}

      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !isLoading && shifts.length === 0 && (
        <EmptyState
          icon={<Target className="w-12 h-12" aria-hidden="true" />}
          title={t('recommendations.empty_title')}
          description={t('recommendations.empty_description')}
          action={hasModule('settings') ? (
            // The description asks the member to add skills; this is where (gap C4).
            <Button
              as={Link}
              to={tenantPath('/settings?tab=skills')}
              variant="secondary"
              startContent={<Settings className="w-4 h-4" aria-hidden="true" />}
            >
              {t('common:skills.add_your_skills')}
            </Button>
          ) : undefined}
        />
      )}

      {!error && !isLoading && shifts.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {shifts.map((item) => (
            <motion.div key={item.shift.id} variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-theme-primary">{item.opportunity.title}</h3>
                      <Chip
                        size="sm"
                        color={getMatchColor(item.match_score)}
                        variant="soft"
                        startContent={<Zap className="w-3 h-3" />}
                      >
                        {t('recommendations.match_score', { score: item.match_score })}
                      </Chip>
                    </div>

                    <p className="text-sm text-theme-muted flex items-center gap-1 mb-2">
                      <Building2 className="w-3 h-3" aria-hidden="true" />
                      {item.organization.name}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-2">
                      {item.opportunity.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {item.opportunity.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {new Date(item.shift.start_time).toLocaleDateString(getFormattingLocale())}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {new Date(item.shift.start_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(item.shift.end_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {item.match_reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.match_reasons.map((reason, i) => (
                          <Chip key={i} size="sm" variant="soft" className="text-theme-subtle text-xs">
                            {reason}
                          </Chip>
                        ))}
                      </div>
                    )}

                    {item.shift.required_skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.shift.required_skills.map((skill) => (
                          <Chip key={skill} size="sm" variant="soft" color="accent" className="text-xs">
                            {skill}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-stretch gap-2 sm:flex-shrink-0 sm:items-center">
                    {/* Circular match-score badge. A horizontal Progress bar squashed
                        into a 14×14 square rendered as a broken sliver, so show the
                        score directly in a colour-coded ring instead. */}
                    <div
                      className={`w-14 h-14 flex items-center justify-center rounded-full border-4 text-sm font-bold ${
                        item.match_score >= 75
                          ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                          : item.match_score >= 50
                            ? 'border-accent text-accent dark:text-accent'
                            : 'border-amber-500 text-amber-600 dark:text-amber-400'
                      }`}
                      role="img"
                      aria-label={t('recommendations.match_aria', { score: item.match_score })}
                    >
                      {item.match_score}%
                    </div>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                      endContent={<ExternalLink className="w-3 h-3" aria-hidden="true" />}
                      onPress={() => navigate(tenantPath(`/volunteering/opportunities/${item.opportunity.id}`))}
                    >
                      {t('recommendations.view_opportunity')}
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

export default RecommendedShiftsTab;
