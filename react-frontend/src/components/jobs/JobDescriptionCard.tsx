// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { useState } from 'react';
import Target from 'lucide-react/icons/target';
import Sparkles from 'lucide-react/icons/sparkles';
import Building2 from 'lucide-react/icons/building-2';
import ChevronUp from 'lucide-react/icons/chevron-up';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { buildVideoEmbedSrc, VIDEO_EMBED_SANDBOX } from '@/lib/videoEmbed';
import type { JobVacancy, MatchResult, QualificationData } from './JobDetailTypes';

interface JobDescriptionCardProps {
  vacancy: JobVacancy;
  isOwner: boolean;
  isAuthenticated: boolean;
  matchResult: MatchResult | null;
  qualificationData: QualificationData | null;
  onCheckQualification: () => void;
}

export function JobDescriptionCard({
  vacancy,
  isOwner,
  isAuthenticated,
  matchResult,
  qualificationData,
  onCheckQualification,
}: JobDescriptionCardProps) {
  const { t } = useTranslation('jobs');
  const [qualOpen, setQualOpen] = useState(false);
  // F-195: the player address is rebuilt from a parsed YouTube/Vimeo id; any
  // other stored link is not framed at all.
  const videoEmbedSrc = buildVideoEmbedSrc(vacancy.video_url);

  return (
    <>
      {/* Description */}
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-4">{t('detail.about')}</h2>
        <SafeHtml content={vacancy.description} className="text-theme-secondary whitespace-pre-wrap" as="div" />
      </GlassCard>

      {/* Match Explanation Card — "Why You Match" */}
      {qualificationData && !isOwner && (
        <GlassCard className="p-4 mt-4">
          <Button
            variant="tertiary"
            onPress={() => setQualOpen(v => !v)}
            aria-expanded={qualOpen}
            className="flex min-h-11 w-full items-center justify-between px-0 text-left"
          >
            <span className="font-semibold flex items-center gap-2">
              <Sparkles size={16} className={qualificationData.percentage >= 70 ? 'text-success' : 'text-warning'} aria-hidden="true" />
              {t('match.why_you_match')} — {qualificationData.percentage}%
            </span>
            {qualOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </Button>
          {qualOpen && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-theme-secondary italic">{qualificationData.ai_summary}</p>
              {qualificationData.dimensions.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {qualificationData.dimensions.map((d) => (
                    <div key={d.label} className="bg-white/5 rounded-lg p-2">
                      <div className="text-xs font-medium text-theme-primary">{d.label}</div>
                      <div className="text-xs text-theme-muted">{d.detail}</div>
                    </div>
                  ))}
                </div>
              )}
              {qualificationData.matched_skills.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-success mb-1">{t('match.you_have')}</p>
                  <div className="flex flex-wrap gap-1">
                    {qualificationData.matched_skills.map((s) => (
                      <Chip key={s} size="sm" color="success" variant="tertiary">{s}</Chip>
                    ))}
                  </div>
                </div>
              )}
              {qualificationData.missing_skills.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-warning mb-1">{t('match.to_develop')}</p>
                  <div className="flex flex-wrap gap-1">
                    {qualificationData.missing_skills.map((s) => (
                      <Chip key={s} size="sm" color="warning" variant="tertiary">{s}</Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </GlassCard>
      )}

      {/* Employer Branding */}
      {(vacancy.tagline || videoEmbedSrc || (vacancy.benefits && vacancy.benefits.length > 0)) && (
        <GlassCard className="p-5 mt-4">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Building2 size={16} aria-hidden="true" />
            {t('branding.about_company')}
          </h2>
          {vacancy.tagline && (
            <p className="text-sm text-theme-secondary italic mb-3">&ldquo;{vacancy.tagline}&rdquo;</p>
          )}
          {videoEmbedSrc && (
            <div className="aspect-video rounded-lg overflow-hidden mb-3">
              <iframe
                src={videoEmbedSrc}
                className="w-full h-full"
                sandbox={VIDEO_EMBED_SANDBOX}
                referrerPolicy="strict-origin-when-cross-origin"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                loading="lazy"
                title={t('branding.video_label')}
              />
            </div>
          )}
          {vacancy.benefits && vacancy.benefits.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {vacancy.benefits.map((b: string) => (
                <Chip key={b} size="sm" variant="tertiary" color="success">{b}</Chip>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Skills */}
      {vacancy.skills.length > 0 && (
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-theme-primary">{t('detail.skills_required')}</h2>
            {isAuthenticated && !isOwner && (
              <Button
                size="sm"
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                startContent={<Target className="w-4 h-4" aria-hidden="true" />}
                onPress={onCheckQualification}
              >
                {t('detail.check_qualification')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(vacancy.skills ?? []).map((skill) => {
              const isMatched = matchResult?.matched?.includes(skill.toLowerCase());
              const isMissing = matchResult?.missing?.includes(skill.toLowerCase());
              return (
                <Chip
                  key={skill}
                  variant="tertiary"
                  color={isMatched ? 'success' : isMissing ? 'danger' : 'accent'}
                  className={isMatched ? 'bg-success/10 text-success' : isMissing ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}
                >
                  {isMatched ? <Check className="w-3 h-3" aria-hidden="true" /> : isMissing ? <X className="w-3 h-3" aria-hidden="true" /> : null}
                  {skill}
                </Chip>
              );
            })}
          </div>
        </GlassCard>
      )}
    </>
  );
}
