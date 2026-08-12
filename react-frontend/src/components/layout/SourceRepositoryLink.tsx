// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link as HeroLink } from '@/components/ui/Link';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTranslation } from 'react-i18next';
import Github from 'lucide-react/icons/github';
import ExternalLink from 'lucide-react/icons/external-link';

// Re-exported so the existing importers (Footer, Layout, MobileDrawer and their
// tests) keep working; the value itself lives in one place with the docs URL.
export { PROJECT_NEXUS_REPO_URL } from '@/config/externalLinks';
import { PROJECT_NEXUS_REPO_URL } from '@/config/externalLinks';

interface SourceRepositoryLinkProps {
  className?: string;
  compact?: boolean;
  inverse?: boolean;
}

export function SourceRepositoryLink({
  className = '',
  compact = false,
  inverse = false,
}: SourceRepositoryLinkProps) {
  const { t } = useTranslation('common');

  const buttonClasses = [
    'group inline-flex min-h-9 min-h-[44px] max-w-full items-center gap-2 rounded-lg border px-3 py-2 no-underline shadow-sm transition-all duration-200',
    inverse
      ? 'border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/15'
      : 'border-theme-default bg-theme-elevated text-theme-primary hover:border-theme-primary/60 hover:bg-theme-primary/10 hover:shadow-md',
    compact ? 'min-w-0' : 'min-w-[13rem]',
    className,
  ].filter(Boolean).join(' ');

  const iconClasses = [
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md shadow-sm transition-transform duration-200 group-hover:scale-105',
    inverse
      ? 'bg-white text-slate-950'
      : 'bg-gradient-to-br from-emerald-500 to-sky-500 text-white',
  ].join(' ');

  return (
    <Tooltip content={t('footer.source_repo_tooltip')} delay={350}>
      <HeroLink
        href={PROJECT_NEXUS_REPO_URL}
        isExternal
        showAnchorIcon={false}
        className={buttonClasses}
        aria-label={t('footer.source_repo_aria')}
      >
        <span className={iconClasses} aria-hidden="true">
          <Github className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="max-w-full truncate text-sm font-semibold">
            {t('footer.project_nexus')}
          </span>
          <span className={`max-w-full truncate text-[12px] font-medium ${inverse ? 'text-white/70' : 'text-theme-muted'}`}>
            {t('footer.source_repo')}
          </span>
        </span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </HeroLink>
    </Tooltip>
  );
}

export default SourceRepositoryLink;
