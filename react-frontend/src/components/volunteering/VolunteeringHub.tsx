// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Heart from 'lucide-react/icons/heart';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Users from 'lucide-react/icons/users';
import Award from 'lucide-react/icons/award';
import Shield from 'lucide-react/icons/shield';
import Accessibility from 'lucide-react/icons/accessibility';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Timer from 'lucide-react/icons/timer';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Search from 'lucide-react/icons/search';
import Siren from 'lucide-react/icons/siren';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTenant } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import type { VolunteeringHubSummary } from './useVolunteeringHubSummary';

const groups = [
  { key: 'find', icon: CalendarDays, tone: 'bg-rose-500/5 border-rose-500/20', sections: ['opportunities', 'recommended', 'alerts'] },
  { key: 'activity', icon: Timer, tone: 'bg-amber-500/5 border-amber-500/20', sections: ['applications', 'hours', 'waitlist', 'swaps'] },
  { key: 'together', icon: Users, tone: 'bg-emerald-500/5 border-emerald-500/20', sections: ['group-signups', 'community-projects', 'donations'] },
  { key: 'support', icon: Award, tone: 'bg-violet-500/5 border-violet-500/20', sections: ['expenses', 'credentials', 'certificates', 'wellbeing'] },
] as const;

/**
 * The hub's main button. A deeper shade of the volunteering pink: white text on
 * the lighter rose-500 end of the page gradient falls short of WCAG AA contrast.
 */
const HUB_PRIMARY = 'min-h-11 bg-linear-to-r from-rose-600 to-pink-700 text-white';

interface HubProps {
  sections: { key: string; label: string }[];
  activeSection?: string;
  onSelect: (key: string) => void;
  summary: VolunteeringHubSummary;
}

/** Presentation only. The parent supplies the same permission-filtered sections
 * used by the original navigation and keeps every existing feature component. */
export function VolunteeringHub({ sections, activeSection, onSelect, summary }: HubProps) {
  const { t } = useTranslation('volunteering');
  const sectionMap = new Map(sections.map(section => [section.key, section]));
  // Nothing to choose between: a signed-out visitor, or a community that only
  // uses the opportunities list. The list itself is the page.
  if (!sections.some(section => section.key !== 'opportunities')) return null;

  const supportSections = ['safeguarding', 'accessibility'].filter(key => sectionMap.has(key));
  const visibleGroups = groups.filter(group => group.sections.some(section => sectionMap.has(section)));
  const number = (value: number) => value.toLocaleString(getFormattingLocale());

  const hintFor = (key: string): string | null => {
    if (key === 'applications' && summary.pendingApplications) {
      const count = `${number(summary.pendingApplications)}${summary.pendingApplicationsCapped ? '+' : ''}`;
      return t('hub.hint_waiting', { number: count });
    }
    if (key === 'alerts' && summary.urgentRequests > 0) {
      return t('hub.hint_to_answer', { number: number(summary.urgentRequests) });
    }
    return null;
  };

  const sectionButton = (key: string) => {
    if (!sectionMap.has(key)) return null;
    const hint = hintFor(key);
    return <Button
      key={key}
      variant="ghost"
      onPress={() => onSelect(key)}
      aria-current={activeSection === key ? 'page' : undefined}
      className={`min-h-11 w-full justify-between whitespace-normal rounded-lg px-3 text-start text-sm text-theme-primary md:min-h-9 ${activeSection === key ? 'bg-theme-hover font-semibold' : ''}`}
      endContent={<span className="flex shrink-0 items-center gap-2">
        {hint && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">{hint}</span>}
        <ChevronRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
      </span>}
    >{t(`hub.links.${key}`)}</Button>;
  };

  const glance = (groupKey: string) => {
    if (groupKey !== 'activity') return null;
    const lines: string[] = [];
    if (summary.nextShift) {
      const when = new Date(summary.nextShift.startTime).toLocaleString(getFormattingLocale(), {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      lines.push(t('hub.next_shift', { when, title: summary.nextShift.title }));
    }
    if (summary.approvedHours) {
      lines.push(t('hub.hours_approved', { number: number(summary.approvedHours) }));
    }
    if (lines.length === 0) return null;
    return <ul className="mt-3 space-y-1 text-sm font-medium text-theme-primary" data-testid="volunteering-hub-glance">
      {lines.map(line => <li key={line}>{line}</li>)}
    </ul>;
  };

  return <nav aria-label={t('hub.navigation')} className="space-y-4" data-testid="volunteering-hub">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {visibleGroups.map(({ key, icon: Icon, tone, sections: keys }, index) => {
        // An odd card out spans the row instead of leaving a hole beside it.
        const spanRow = visibleGroups.length % 2 === 1 && index === visibleGroups.length - 1;
        return <Card key={key} shadow="none" className={`relative overflow-hidden rounded-2xl border p-5 sm:p-6 ${tone} ${spanRow ? 'md:col-span-2' : ''}`}>
          <div className="flex items-start gap-4">
            <Icon className="mt-1 h-6 w-6 shrink-0 text-theme-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-theme-primary">{t(`hub.${key}_title`)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-theme-muted">{t(`hub.${key}_description`)}</p>
              {glance(key)}
              <div className="mt-3 -ms-3">{keys.map(sectionButton)}</div>
            </div>
          </div>
        </Card>;
      })}
    </div>
    {supportSections.length > 0 && <Card shadow="none" className="flex flex-col gap-4 rounded-2xl border border-theme-default bg-theme-elevated p-5 lg:flex-row lg:items-center">
      <div className="flex flex-1 items-start gap-3">
        <Heart className="h-6 w-6 shrink-0 text-theme-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold text-theme-primary">{t('hub.here_to_support')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('hub.here_to_support_description')}</p>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        {supportSections.map(key => {
          const Icon = key === 'safeguarding' ? Shield : Accessibility;
          return <div key={key} className="flex items-center gap-1">
            <Icon className="h-5 w-5 shrink-0 text-theme-primary" aria-hidden="true" />
            {sectionButton(key)}
          </div>;
        })}
      </div>
    </Card>}
  </nav>;
}

/** Shown above everything while an urgent request is waiting for this member's answer. */
export function VolunteeringUrgentBanner({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { t } = useTranslation('volunteering');
  if (count <= 0) return null;
  const action = (className: string) => (
    <Button variant="danger" className={`min-h-11 ${className}`} onPress={onOpen}>{t('hub.urgent_action')}</Button>
  );
  return <Alert
    color="danger"
    data-testid="volunteering-urgent-banner"
    icon={<Siren className="h-5 w-5" aria-hidden="true" />}
    title={t('hub.urgent_title', { number: count.toLocaleString(getFormattingLocale()) })}
    description={<>
      {t('hub.urgent_description')}
      <span className="mt-2 block sm:hidden">{action('w-full')}</span>
    </>}
    endContent={action('hidden shrink-0 sm:inline-flex')}
  />;
}

interface HeaderProps {
  /** `true` log hours, `false` cannot yet (offer the list instead), `null` still checking. */
  canLogHours: boolean | null;
  onLogHours: () => void;
  onFindOpportunities: () => void;
  hasOrganisations: boolean;
  manageHref?: string;
  canRegisterOrganisation?: boolean;
  canPostOpportunity?: boolean;
  pendingOrganisationName?: string;
  onExit: () => void;
}

export function VolunteeringPreviewHeader({ canLogHours, onLogHours, onFindOpportunities, hasOrganisations, manageHref, canRegisterOrganisation, canPostOpportunity, pendingOrganisationName, onExit }: HeaderProps) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-theme-default bg-theme-elevated px-4 py-2">
      <span className="text-sm text-theme-muted">{t('hub.preview')}</span>
      <Button variant="tertiary" onPress={onExit} className="min-h-11 whitespace-normal text-start" startContent={<ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />}>
        {t('hub.back_to_current')}
      </Button>
    </div>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-2xl">
        <p className="mb-2 text-sm font-medium text-theme-muted">{t('heading')}</p>
        <h1 className="text-2xl font-bold tracking-tight text-theme-primary sm:text-3xl lg:text-4xl">{t('hub.title')}</h1>
        <p className="mt-3 text-base leading-relaxed text-theme-muted">{t('hub.subtitle')}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-xs sm:justify-end">
        {canLogHours === true && <Button variant="primary" className={HUB_PRIMARY} onPress={onLogHours} startContent={<Timer className="h-4 w-4" aria-hidden="true" />}>{t('log_hours')}</Button>}
        {canLogHours === false && <Button variant="primary" className={HUB_PRIMARY} onPress={onFindOpportunities} startContent={<Search className="h-4 w-4" aria-hidden="true" />}>{t('hub.find_opportunities')}</Button>}
        {hasOrganisations && <Button as={Link} to={tenantPath('/organisations')} variant="secondary" className="min-h-11">{t('browse_organisations')}</Button>}
      </div>
    </div>
    <div className="flex flex-col gap-3 border-b border-theme-default pb-3 lg:flex-row lg:items-start lg:justify-between">
    <details className="max-w-xl rounded-xl px-1 py-2 text-sm text-theme-muted">
      <summary className="cursor-pointer py-1 font-medium text-theme-primary">{t('hub.how_it_works')}</summary>
      <p className="pt-3 leading-relaxed">{t('hub.how_it_works_description')}</p>
    </details>
    {hasOrganisations && (manageHref || canRegisterOrganisation) && <div className="flex flex-wrap items-center gap-2 text-sm lg:justify-end">
      <span className="text-theme-muted">{pendingOrganisationName ? t('org_pending_desc', { name: pendingOrganisationName }) : t('hub.organiser')}</span>
      <div className="flex flex-wrap gap-2">
        <Button as={Link} to={manageHref ?? tenantPath('/organisations/register')} variant="tertiary" className="min-h-11" endContent={<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}>{t(manageHref ? 'manage_organisation' : 'register_organisation')}</Button>
        {canPostOpportunity && <Button as={Link} to={tenantPath('/volunteering/create')} variant="secondary" className="min-h-11">{t('post_opportunity')}</Button>}
      </div>
    </div>}
    </div>
  </div>;
}
