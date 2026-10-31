// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Tooltip } from '@/components/ui/Tooltip';
import { Link } from 'react-router-dom';

import Briefcase from 'lucide-react/icons/briefcase';
import MapPin from 'lucide-react/icons/map-pin';
import Eye from 'lucide-react/icons/eye';
import FileText from 'lucide-react/icons/file-text';
import Edit3 from 'lucide-react/icons/pen-line';
import Trash2 from 'lucide-react/icons/trash-2';
import Mail from 'lucide-react/icons/mail';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Heart from 'lucide-react/icons/heart';
import Timer from 'lucide-react/icons/timer';
import Calendar from 'lucide-react/icons/calendar';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Bookmark from 'lucide-react/icons/bookmark';
import BookmarkCheck from 'lucide-react/icons/bookmark-check';
import BarChart3 from 'lucide-react/icons/chart-column';
import Star from 'lucide-react/icons/star';
import EyeOff from 'lucide-react/icons/eye-off';
import Globe from 'lucide-react/icons/globe';
import Copy from 'lucide-react/icons/copy';
import Send from 'lucide-react/icons/send';
import Share2 from 'lucide-react/icons/share-2';
import { useTranslation } from 'react-i18next';
import { formatDateValue, resolveAvatarUrl } from '@/lib/helpers';
import { MatchBadge } from './MatchBadge';
import type { JobVacancy, MatchResult } from './JobDetailTypes';
import { TYPE_CHIP_COLORS } from './JobDetailTypes';

const TYPE_ICONS: Record<string, typeof DollarSign> = {
  paid: DollarSign,
  volunteer: Heart,
  timebank: Timer,
};

interface JobDetailHeaderProps {
  vacancy: JobVacancy;
  isOwner: boolean;
  isAuthenticated: boolean;
  isSaved: boolean;
  isSaving: boolean;
  isPastDeadline: boolean;
  matchResult: MatchResult | null;
  formatSalary: () => string | null;
  tenantPath: (path: string) => string;
  onToggleSave: () => void;
  onRenewOpen: () => void;
  onDeleteOpen: () => void;
  onCopyLink: () => void;
  /** The title as shown — the reader's translation while one is on (31 Oct 2026). */
  displayTitle?: string | null;
}

export function JobDetailHeader({
  vacancy,
  isOwner,
  isAuthenticated,
  isSaved,
  isSaving,
  isPastDeadline,
  matchResult,
  formatSalary,
  tenantPath,
  onToggleSave,
  onRenewOpen,
  onDeleteOpen,
  onCopyLink,
  displayTitle,
}: JobDetailHeaderProps) {
  const { t } = useTranslation('jobs');
  const TypeIcon = TYPE_ICONS[vacancy.type] ?? Briefcase;
  const deadlineDate = vacancy.deadline ? new Date(vacancy.deadline) : null;
  const salaryDisplay = formatSalary();

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="text-2xl font-bold text-theme-primary">{displayTitle ?? vacancy.title}</h1>
            {vacancy.is_featured && (
              <Chip size="sm" variant="tertiary" color="warning">
                <Star className="w-3 h-3" aria-hidden="true" />
                {t('featured')}
              </Chip>
            )}
            <Chip size="sm" variant="tertiary" color={TYPE_CHIP_COLORS[vacancy.type] ?? 'default'}>
              <span className="flex items-center gap-1">
                <TypeIcon className="w-3 h-3" aria-hidden="true" />
                {t(`type.${vacancy.type}`)}
              </span>
            </Chip>
            <Chip size="sm" variant="tertiary" color="default">
              {t(`commitment.${vacancy.commitment}`)}
            </Chip>
            <Chip size="sm" variant="tertiary" color={vacancy.status === 'open' ? 'success' : 'default'}>
              {t(`status.${vacancy.status}`)}
            </Chip>
            {vacancy.blind_hiring && (
              <Chip size="sm" variant="tertiary" color="accent">
                <EyeOff className="w-3 h-3" aria-hidden="true" />
                {t('blind_hiring.enabled_badge')}
              </Chip>
            )}
          </div>

          {vacancy.blind_hiring && isOwner && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-500/10 border border-violet-500/20 p-3">
              <EyeOff className="w-4 h-4 text-violet-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm text-violet-600 dark:text-violet-400">{t('blind_hiring.info_banner')}</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <Avatar
              name={vacancy.creator?.name}
              src={resolveAvatarUrl(vacancy.creator?.avatar_url)}
              size="sm"
              isBordered
            />
            <div>
              <p className="text-sm text-theme-primary font-medium">
                {vacancy.organization?.name ?? vacancy.creator?.name}
              </p>
              <p className="text-xs text-theme-subtle">
                {t('posted_by')} {vacancy.creator?.name} &middot; {vacancy.created_at ? formatDateValue(vacancy.created_at) : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {isAuthenticated && !isOwner && (
            <Tooltip content={isSaved ? t('saved.unsave') : t('saved.save')}>
              <Button
                size="sm"
                variant="flat"
                isIconOnly
                className={isSaved ? 'text-warning bg-warning/10' : 'bg-theme-elevated text-theme-muted'}
                onPress={onToggleSave}
                isLoading={isSaving}
                aria-label={isSaved ? t('saved.unsave') : t('saved.save')}
              >
                {isSaved ? <BookmarkCheck className="w-4 h-4" aria-hidden="true" /> : <Bookmark className="w-4 h-4" aria-hidden="true" />}
              </Button>
            </Tooltip>
          )}

          <Dropdown>
            <DropdownTrigger>
              <Button
                size="sm"
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                startContent={<Share2 size={14} aria-hidden="true" />}
                aria-label={t('share.title')}
              >
                {t('share.title')}
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label={t('share.title')}>
              <DropdownItem
                key="copy" id="copy"
                startContent={<Copy className="w-4 h-4" aria-hidden="true" />}
                onPress={onCopyLink}
              >
                {t('share.copy_link')}
              </DropdownItem>
              <DropdownItem
                key="email" id="email"
                startContent={<Mail className="w-4 h-4" aria-hidden="true" />}
                onPress={() => {
                  const jobUrl = window.location.origin + tenantPath(`/jobs/${vacancy.id}`);
                  const subject = encodeURIComponent(vacancy.title);
                  const body = encodeURIComponent(t('share.email_body', { title: vacancy.title, url: jobUrl }));
                  window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                }}
              >
                {t('share.email')}
              </DropdownItem>
              <DropdownItem
                key="native-share" id="native-share"
                className={typeof navigator !== 'undefined' && 'share' in navigator ? '' : 'hidden'}
                startContent={<Send className="w-4 h-4" aria-hidden="true" />}
                onPress={() => {
                  navigator.share?.({
                    title: vacancy.title,
                    text: t('share.native_text', { type: t(`type.${vacancy.type}`), title: vacancy.title }),
                    url: window.location.origin + tenantPath(`/jobs/${vacancy.id}`),
                  }).catch(() => {});
                }}
              >
                {t('share.native')}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>

          {isOwner && (
            <>
              <Button as={Link} to={tenantPath(`/jobs/${vacancy.id}/analytics`)}
                size="sm"
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                startContent={<BarChart3 className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail.analytics')}
              </Button>

              {(isPastDeadline || vacancy.status === 'closed') && (
                <Button
                  size="sm"
                  variant="flat"
                  color="warning"
                  startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  onPress={onRenewOpen}
                >
                  {t('detail.renew')}
                </Button>
              )}

              <Button as={Link} to={tenantPath(`/jobs/${vacancy.id}/edit`)}
                size="sm"
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                startContent={<Edit3 className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail.edit')}
              </Button>
              <Button
                size="sm"
                variant="flat"
                color="danger"
                startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                onPress={onDeleteOpen}
              >
                {t('detail.delete')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-theme-subtle">
        {vacancy.is_remote ? (
          <span className="flex items-center gap-1">
            <Globe className="w-4 h-4" aria-hidden="true" />
            {t('remote')}
          </span>
        ) : vacancy.location ? (
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" aria-hidden="true" />
            {vacancy.location}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-theme-muted">
            <MapPin className="w-4 h-4" aria-hidden="true" />
            {t('location_not_specified')}
          </span>
        )}

        <span className="flex items-center gap-1">
          <Eye className="w-4 h-4" aria-hidden="true" />
          {t('detail.views', { count: vacancy.views_count })}
        </span>

        <span className="flex items-center gap-1">
          <FileText className="w-4 h-4" aria-hidden="true" />
          {t('applications', { count: vacancy.applications_count })}
        </span>

        {deadlineDate && (
          <span className={`flex items-center gap-1 ${isPastDeadline ? 'text-danger' : ''}`}>
            <Calendar className="w-4 h-4" aria-hidden="true" />
            {isPastDeadline
              ? t('deadline_passed')
              : `${t('detail.deadline_label')}: ${formatDateValue(deadlineDate)}`}
          </span>
        )}

        {salaryDisplay ? (
          <span className="flex items-center gap-1 font-medium text-theme-primary">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            {salaryDisplay}
            {vacancy.salary_negotiable && (
              <span className="text-xs text-theme-subtle font-normal">({t('salary.negotiable')})</span>
            )}
          </span>
        ) : vacancy.salary_negotiable ? (
          <span className="flex items-center gap-1 text-theme-subtle">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">{t('salary.negotiable')}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-theme-muted">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">{t('salary_not_specified')}</span>
          </span>
        )}
      </div>

      {matchResult && matchResult.required_skills.length > 0 && (
        <div className="mt-4">
          <MatchBadge match={matchResult} />
        </div>
      )}
    </GlassCard>
  );
}
