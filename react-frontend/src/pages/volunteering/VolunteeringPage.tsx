// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteering Page - Browse opportunities, track hours, manage applications
 */

import { getFormattingLocale } from '@/lib/helpers';
import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, type Key } from 'react';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButtonGroup, ToggleButton } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import {
  VolunteeringFilterSheet,
  EMPTY_VOLUNTEERING_FILTER_DRAFT,
  type VolunteeringFilterDraft,
  type VolunteeringFormat,
} from '@/components/volunteering/VolunteeringFilterSheet';
import { VolunteeringSectionsSheet } from '@/components/volunteering/VolunteeringSectionsSheet';

import Heart from 'lucide-react/icons/heart';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Building2 from 'lucide-react/icons/building-2';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Send from 'lucide-react/icons/send';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Hourglass from 'lucide-react/icons/hourglass';
import TrendingUp from 'lucide-react/icons/trending-up';
import Globe from 'lucide-react/icons/globe';
import Briefcase from 'lucide-react/icons/briefcase';
import Timer from 'lucide-react/icons/timer';
import Sparkles from 'lucide-react/icons/sparkles';
import Award from 'lucide-react/icons/award';
import Siren from 'lucide-react/icons/siren';
import Smile from 'lucide-react/icons/smile';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Users from 'lucide-react/icons/users';
import MessageSquare from 'lucide-react/icons/message-square';
import Receipt from 'lucide-react/icons/receipt';
import Shield from 'lucide-react/icons/shield';
import Lightbulb from 'lucide-react/icons/lightbulb';
import HandHeart from 'lucide-react/icons/hand-heart';
import Info from 'lucide-react/icons/info';
import Accessibility from 'lucide-react/icons/accessibility';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { EmptyState } from '@/components/feedback';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
// DIRECT hook paths on purpose: this page's test fully mocks the '@/hooks'
// barrel, so a barrel import of these would resolve to undefined at call time.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getOpportunityCategoryName, type OpportunityCategory } from '@/lib/volunteering';
import type { VolunteeringConfig } from '@/types';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';
import { extractCollectionItems } from './extractCollectionItems';
const VolunteeringWelcome = React.lazy(() => import('./VolunteeringWelcome'));
const RecommendedShiftsTab = React.lazy(() => import('./RecommendedShiftsTab'));
const EmergencyAlertsTab = React.lazy(() => import('./EmergencyAlertsTab'));
const CertificatesTab = React.lazy(() => import('./CertificatesTab'));
const WellbeingTab = React.lazy(() => import('./WellbeingTab'));
const CredentialVerificationTab = React.lazy(() => import('./CredentialVerificationTab'));
const WaitlistTab = React.lazy(() => import('./WaitlistTab'));
const ShiftSwapsTab = React.lazy(() => import('./ShiftSwapsTab'));
const GroupSignUpTab = React.lazy(() => import('./GroupSignUpTab'));
const GuardianConsentModal = React.lazy(() => import('@/components/volunteering/GuardianConsentModal'));
const ExpensesTab = React.lazy(() => import('./ExpensesTab'));
const SafeguardingTab = React.lazy(() => import('./SafeguardingTab'));
const CommunityProjectsTab = React.lazy(() => import('./CommunityProjectsTab'));
const DonationsTab = React.lazy(() => import('./DonationsTab'));
const AccessibilityTab = React.lazy(() => import('./AccessibilityTab'));
const LazyProximityFilter = React.lazy(() =>
  import('@/components/proximity/ProximityFilter').then((module) => ({
    default: module.ProximityFilter,
  })),
);

/* ───────────────────────── Types ───────────────────────── */

interface Organization {
  id: number;
  name: string;
  logo_url?: string | null;
  status?: string;
  member_role?: string;
}

interface Opportunity {
  id: number;
  title: string;
  description: string;
  location: string;
  skills_needed: string;
  start_date: string | null;
  distance_km?: number;
  end_date: string | null;
  is_active: boolean;
  is_remote: boolean;
  /** String on some endpoints, { id, name, color } object on others — always unwrap via getOpportunityCategoryName(). */
  category: OpportunityCategory;
  organization: Organization;
  created_at: string;
  has_applied?: boolean;
}

interface Application {
  id: number;
  status: 'pending' | 'approved' | 'declined';
  message: string;
  opportunity: {
    id: number;
    title: string;
    location: string;
  };
  organization: {
    id: number;
    name: string;
    logo_url: string | null;
  };
  shift?: {
    id: number;
    start_time: string;
    end_time: string;
  } | null;
  org_note?: string | null;
  created_at: string;
}

interface HoursSummary {
  total_verified: number;
  total_pending: number;
  total_declined: number;
  by_organization: { name: string; hours: number }[];
  by_month: { month: string; hours: number }[];
}

type VolunteerTab = 'opportunities' | 'applications' | 'hours' | 'recommended' | 'certificates' | 'alerts' | 'wellbeing' | 'credentials' | 'waitlist' | 'swaps' | 'group-signups' | 'expenses' | 'safeguarding' | 'community-projects' | 'donations' | 'accessibility';

const VOLUNTEER_TABS: VolunteerTab[] = ['opportunities', 'applications', 'hours', 'recommended', 'certificates', 'alerts', 'wellbeing', 'credentials', 'waitlist', 'swaps', 'group-signups', 'expenses', 'safeguarding', 'community-projects', 'donations', 'accessibility'];

// The handful of tabs a volunteer reaches for constantly. Everything else is
// tucked behind a "More" toggle so the page doesn't open as a wall of tabs.
const PRIMARY_VOLUNTEER_TABS: VolunteerTab[] = ['opportunities', 'applications', 'hours', 'recommended', 'certificates'];

const VOLUNTEER_TAB_FEATURE_GATES: Partial<Record<VolunteerTab, (keyof VolunteeringConfig)[]>> = {
  recommended: ['volunteering.enable_matching'],
  expenses: ['volunteering.expenses_enabled'],
};

// Volunteering brand gradient — centralized so it can be themed later via tokens.
const VOL_GRADIENT_BASE = 'bg-linear-to-r from-rose-500 to-pink-600';
const VOL_GRADIENT = `${VOL_GRADIENT_BASE} text-white`;

// Today's date as YYYY-MM-DD in the user's LOCAL timezone. `toISOString()`
// returns UTC, so for users west of UTC it can roll back to "yesterday" for
// several hours after local midnight — a logged-hours date one day too early.
function localCalendarDate(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format a 'YYYY-MM' bucket as a localized "Month YYYY" label. Parsing
// `new Date('YYYY-MM-01')` treats the string as UTC midnight, which renders as
// the PREVIOUS month for UTC-negative timezones — so build a LOCAL date instead.
function formatYearMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map((n) => parseInt(n, 10));
  if (!y || !m) return yearMonth;
  return new Date(y, m - 1, 1).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long' });
}

const statusColor = (status: string) => {
  switch (status) {
    case 'approved': return 'success';
    case 'declined': return 'danger';
    default: return 'warning';
  }
};

const statusIcon = (status: string) => {
  switch (status) {
    case 'approved': return <CheckCircle className="w-3 h-3" aria-hidden="true" />;
    case 'declined': return <XCircle className="w-3 h-3" aria-hidden="true" />;
    default: return <Hourglass className="w-3 h-3" aria-hidden="true" />;
  }
};

/* ───────────────────────── Main Component ───────────────────────── */

export function VolunteeringPage() {
  const { t } = useTranslation('volunteering');
  usePageTitle(t('page_title'));
  // Phones hide the hero/banner stack, so the page title moves into the app bar.
  // These three must stay ABOVE the feature-gate early return below.
  useSetAppBarTitle(t('heading'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasFeature, volunteeringConfig } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  // Check if a volunteering tab is enabled via config
  // Config keys use underscores (tab_group_signups), frontend tab keys use hyphens (group-signups)
  const isTabEnabled = useCallback((tabKey: VolunteerTab): boolean => {
    const configKey = `volunteering.tab_${tabKey.replace(/-/g, '_')}` as keyof VolunteeringConfig;
    const config = volunteeringConfig as Partial<VolunteeringConfig> | undefined;
    const requiredFeatures = VOLUNTEER_TAB_FEATURE_GATES[tabKey] ?? [];
    return config?.[configKey] !== false && requiredFeatures.every((key) => config?.[key] !== false);
  }, [volunteeringConfig]);

  const requestedTab = searchParams.get('tab') as VolunteerTab | null;
  const initialTab = requestedTab && VOLUNTEER_TABS.includes(requestedTab) ? requestedTab : 'opportunities';
  const [tab, setTabState] = useState<VolunteerTab>(initialTab);

  const setTab = useCallback((newTab: VolunteerTab) => {
    setTabState(newTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'opportunities') {
        next.delete('tab');
      } else {
        next.set('tab', newTab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  type MyOrg = { id: number; name: string; status: string; role: string };
  const [myOrgs, setMyOrgs] = useState<MyOrg[]>([]);
  const [showMoreTabs, setShowMoreTabs] = useState(false);
  // Phone-only: the wrapping pill wall is replaced by one control + this sheet.
  const [isSectionsSheetOpen, setIsSectionsSheetOpen] = useState(false);
  // Orgs the user can actually manage (owner/admin) and that are live.
  const manageableOrgs = myOrgs.filter(
    (o) => ['approved', 'active'].includes(o.status) && ['owner', 'admin'].includes(o.role),
  );
  // Orgs the user registered that are still awaiting platform approval.
  const pendingOrgs = myOrgs.filter(
    (o) => o.status === 'pending' && ['owner', 'admin'].includes(o.role),
  );
  const hasApprovedOrg = manageableOrgs.length > 0;
  // Captured so TS narrows the index access (noUncheckedIndexedAccess).
  const soleManagedOrg = manageableOrgs.length === 1 ? manageableOrgs[0] : undefined;
  const firstPendingOrg = pendingOrgs[0];
  // Where the "manage" CTA points: straight to the dashboard for a single org,
  // otherwise the chooser page.
  const manageHref = soleManagedOrg
    ? tenantPath(`/volunteering/org/${soleManagedOrg.id}/dashboard`)
    : tenantPath('/volunteering/my-organisations');

  const isTabAllowed = useCallback((tabKey: VolunteerTab): boolean => (
    VOLUNTEER_TABS.includes(tabKey) && (tabKey === 'opportunities' || isAuthenticated) && isTabEnabled(tabKey)
  ), [isAuthenticated, isTabEnabled]);

  useEffect(() => {
    if (isTabAllowed(tab)) return;
    const fallbackTab = VOLUNTEER_TABS.find(isTabAllowed);
    if (fallbackTab && fallbackTab !== tab) {
      setTab(fallbackTab);
    }
  }, [tab, isTabAllowed, setTab]);

  useEffect(() => {
    const nextTab = requestedTab && VOLUNTEER_TABS.includes(requestedTab) ? requestedTab : 'opportunities';
    if (nextTab !== tab && isTabAllowed(nextTab)) {
      setTabState(nextTab);
    }
  }, [requestedTab, tab, isTabAllowed]);

  useEffect(() => {
    if (!hasFeature('volunteering')) return;
    let cancelled = false;
    if (isAuthenticated) {
      api.get<unknown>('/v2/volunteering/my-organisations')
        .then((res) => {
          if (!cancelled && res.success && res.data) {
            const items = extractCollectionItems<{ id: number; name: string; status: string; member_role: string; balance?: number }>(res.data);
            setMyOrgs(items.map((o) => ({ id: o.id, name: o.name, status: o.status, role: o.member_role })));
          }
        })
        .catch(() => { /* silent — org tools just won't show */ });
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, hasFeature]);

  // Feature gate
  if (!hasFeature('volunteering')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 py-16 text-center">
        {/* Intentional decorative gradient — kept as manually managed dark mode for brand warmth */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-orange-100 dark:from-rose-900/30 dark:to-orange-900/30 flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-rose-500" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-theme-primary mb-2">{t('feature_not_available')}</h2>
        <p className="text-[var(--color-text-muted)] max-w-sm">
          {t('feature_not_available_desc')}
        </p>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      <PageMeta
        title={t('page_title')}
        description={t('page_description')}
      />

      {/* One-time welcome for signed-in members (dismissible, localStorage). */}
      {isAuthenticated && (
        <Suspense fallback={null}>
          <VolunteeringWelcome />
        </Suspense>
      )}

      {/* Hero — the VOLUNTEER view. Uses the shared PublicPageHero so it matches
          the Organisations landing for a consistent, professional look.
          Phones hide it entirely: the title lives in the app bar
          (useSetAppBarTitle) and its two actions are re-homed into the compact
          phone action row below. */}
      {!isPhone && (
      <PublicPageHero
        eyebrow={t('hero_eyebrow')}
        title={t('heading')}
        description={t('volunteer_view_subtitle')}
        accent="rose"
        icon={<Heart className="h-7 w-7" aria-hidden="true" />}
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {isAuthenticated && (
              <Button
                as={Link}
                to={tenantPath('/volunteering?tab=hours')}
                variant="primary"
                className="w-full sm:w-auto bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                startContent={<Timer className="w-4 h-4" aria-hidden="true" />}
              >
                {t('log_hours')}
              </Button>
            )}
            <Button
              as={Link}
              to={tenantPath('/organisations')}
              variant="secondary"
              className="w-full sm:w-auto"
              startContent={<Globe className="w-4 h-4" aria-hidden="true" />}
            >
              {t('browse_organisations')}
            </Button>
          </div>
        }
      />
      )}

      {/* Plain-language "how it works" so a first-time volunteer isn't guessing
          what to do or how they get their time credits. On phones it collapses to
          a one-line disclosure rather than disappearing: an anonymous phone
          visitor would otherwise get no explanation anywhere of how volunteered
          hours become time credits. Signed-in members also get the dismissible
          VolunteeringWelcome card above. */}
      {isPhone ? (
        <GlassCard className="p-4">
          <Disclosure>
            <DisclosureHeading>
              <DisclosureTrigger className="flex w-full min-h-11 items-center justify-between gap-3 text-left">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400">
                    <Info className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="truncate text-sm font-semibold text-theme-primary">
                    {t('how_it_works_title')}
                  </span>
                </span>
                <DisclosureIndicator />
              </DisclosureTrigger>
            </DisclosureHeading>
            <DisclosureContent>
              <DisclosureBody>
                <p className="pt-2 text-sm text-theme-muted">{t('how_it_works')}</p>
              </DisclosureBody>
            </DisclosureContent>
          </Disclosure>
        </GlassCard>
      ) : (
      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400 shrink-0">
            <Info className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-theme-primary">{t('how_it_works_title')}</h2>
            <p className="text-sm text-theme-muted">{t('how_it_works')}</p>
          </div>
        </div>
      </GlassCard>
      )}

      {/* ───────── The ORGANISATION door — the second "hat". ─────────
          Kept visually separate from the volunteer hero above so it's obvious
          these are two different modes: "I volunteer" vs "I run an organisation".
          Previously the only entry was a button hidden behind hasApprovedOrg, so
          owners with a pending org saw nothing at all. */}
      {!isPhone && isAuthenticated && hasApprovedOrg && (
        <GlassCard className="p-4 sm:p-5 border border-rose-500/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400 shrink-0">
                <Building2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">{t('for_organisations')}</p>
                <h2 className="text-base font-semibold text-theme-primary">
                  {soleManagedOrg
                    ? t('org_callout_you_manage_one', { name: soleManagedOrg.name })
                    : t('org_callout_you_manage_many', { count: manageableOrgs.length })}
                </h2>
                <p className="text-sm text-theme-muted">{t('org_callout_desc')}</p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0">
              <Button
                as={Link}
                to={manageHref}
                variant="primary"
                className="w-full sm:w-auto"
                startContent={<Building2 className="w-4 h-4" aria-hidden="true" />}
              >
                {t('manage_organisation')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/volunteering/create')}
                variant="secondary"
                className="w-full sm:w-auto"
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('post_opportunity')}
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Org awaiting approval — previously rendered NOTHING, stranding the owner.
          Deliberately NOT phone-gated: it is two short lines and it is the only
          place an owner learns their registration is still in review. */}
      {isAuthenticated && !hasApprovedOrg && pendingOrgs.length > 0 && (
        <GlassCard className="p-4 sm:p-5 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400 shrink-0">
              <Hourglass className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-theme-primary">{t('org_pending_title')}</h2>
              <p className="text-sm text-theme-muted">{t('org_pending_desc', { name: firstPendingOrg?.name ?? '' })}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* No org yet — a quiet nudge that explains the second hat exists.
          Phone-hidden; its "Register organisation" CTA is re-homed below. */}
      {!isPhone && isAuthenticated && !hasApprovedOrg && pendingOrgs.length === 0 && (
        <GlassCard className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="rounded-lg bg-theme-elevated p-2 text-theme-muted shrink-0">
                <Building2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-theme-primary">{t('org_register_title')}</h2>
                <p className="text-sm text-theme-muted">{t('org_register_desc')}</p>
              </div>
            </div>
            <Button
              as={Link}
              to={tenantPath('/organisations/register')}
              variant="secondary"
              className="w-full sm:w-auto sm:shrink-0"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('register_organisation')}
            </Button>
          </div>
        </GlassCard>
      )}

      {/* ───────── Phone: compact action row ─────────
          The hero and the two org-door cards above are hidden on phones, and
          between them they held the ONLY phone entry points to logging hours,
          browsing organisations, the org dashboard, posting an opportunity and
          registering an organisation. They are re-homed here as small buttons
          (44px touch targets) that wrap into at most two rows — roughly a tenth
          of the height the three cards cost. */}
      {isPhone && (
        <div className="flex flex-wrap items-center gap-2 sm:hidden">
          {isAuthenticated && (
            <Button
              as={Link}
              to={tenantPath('/volunteering?tab=hours')}
              size="sm"
              variant="primary"
              className={`min-h-11 ${VOL_GRADIENT}`}
              startContent={<Timer className="w-4 h-4" aria-hidden="true" />}
            >
              {t('log_hours')}
            </Button>
          )}
          <Button
            as={Link}
            to={tenantPath('/organisations')}
            size="sm"
            variant="secondary"
            className="min-h-11"
            startContent={<Globe className="w-4 h-4" aria-hidden="true" />}
          >
            {t('browse_organisations')}
          </Button>
          {isAuthenticated && hasApprovedOrg && (
            <>
              <Button
                as={Link}
                to={manageHref}
                size="sm"
                variant="secondary"
                className="min-h-11"
                startContent={<Building2 className="w-4 h-4" aria-hidden="true" />}
              >
                {t('manage_organisation')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/volunteering/create')}
                size="sm"
                variant="secondary"
                className="min-h-11"
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('post_opportunity')}
              </Button>
            </>
          )}
          {isAuthenticated && !hasApprovedOrg && pendingOrgs.length === 0 && (
            <Button
              as={Link}
              to={tenantPath('/organisations/register')}
              size="sm"
              variant="secondary"
              className="min-h-11"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('register_organisation')}
            </Button>
          )}
        </div>
      )}

      {/* Tabs */}
      {/* Tabs — data-driven with config-based visibility */}
      {(() => {
        type TabDef = { key: VolunteerTab; icon: typeof Briefcase; label: string; authOnly?: boolean };
        const allTabs: TabDef[] = [
          { key: 'opportunities', icon: Briefcase, label: t('tab_opportunities') },
          { key: 'applications', icon: Send, label: t('tab_applications'), authOnly: true },
          { key: 'hours', icon: Timer, label: t('tab_hours'), authOnly: true },
          { key: 'recommended', icon: Sparkles, label: t('tab_for_you'), authOnly: true },
          { key: 'certificates', icon: Award, label: t('tab_certificates'), authOnly: true },
          { key: 'alerts', icon: Siren, label: t('tab_alerts'), authOnly: true },
          { key: 'wellbeing', icon: Smile, label: t('tab_wellbeing'), authOnly: true },
          { key: 'credentials', icon: ShieldCheck, label: t('tab_credentials'), authOnly: true },
          { key: 'waitlist', icon: Clock, label: t('tab_waitlist'), authOnly: true },
          { key: 'swaps', icon: ArrowLeftRight, label: t('tab_swap_requests'), authOnly: true },
          { key: 'group-signups', icon: Users, label: t('tab_group_signups'), authOnly: true },
          { key: 'expenses', icon: Receipt, label: t('tab_expenses'), authOnly: true },
          { key: 'safeguarding', icon: Shield, label: t('tab_safeguarding'), authOnly: true },
          { key: 'community-projects', icon: Lightbulb, label: t('tab_community_projects'), authOnly: true },
          { key: 'donations', icon: HandHeart, label: t('tab_donations'), authOnly: true },
          { key: 'accessibility', icon: Accessibility, label: t('tab_accessibility'), authOnly: true },
        ];

        const visibleTabs = allTabs.filter(t => {
          if (t.authOnly && !isAuthenticated) return false;
          return isTabEnabled(t.key);
        });
        const activeTab = visibleTabs.some(({ key }) => key === tab)
          ? tab
          : visibleTabs[0]?.key;

        const primaryTabs = visibleTabs.filter(({ key }) => PRIMARY_VOLUNTEER_TABS.includes(key));
        const moreTabs = visibleTabs.filter(({ key }) => !PRIMARY_VOLUNTEER_TABS.includes(key));
        const activeIsMore = !!activeTab && moreTabs.some(({ key }) => key === activeTab);
        const moreExpanded = showMoreTabs || activeIsMore;
        // Phone section picker: the trigger shows where you are, the sheet moves you.
        const activeTabDef = visibleTabs.find(({ key }) => key === activeTab);
        const ActiveTabIcon = activeTabDef?.icon;

        const renderToggle = (tabsToRender: TabDef[]) => (
          <ToggleButtonGroup
            isDetached
            selectionMode="single"
            selectedKeys={activeTab ? new Set([activeTab]) : new Set()}
            onSelectionChange={(keys) => {
              const [nextTab] = Array.from(keys as Set<Key>);
              const nextVolunteerTab = String(nextTab) as VolunteerTab;
              if (nextTab && VOLUNTEER_TABS.includes(nextVolunteerTab)) {
                setTab(nextVolunteerTab);
              }
            }}
            className="flex flex-wrap gap-2"
            aria-label={t('aria.volunteering_sections')}
          >
            {tabsToRender.map(({ key, icon: Icon, label }) => (
              <ToggleButton
                key={key}
                id={key}
                aria-label={label}
                className={activeTab === key ? VOL_GRADIENT : 'bg-theme-elevated text-theme-muted'}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        );

        return (
          <>
            {visibleTabs.length === 0 && (
              <EmptyState
                icon={<Heart className="w-12 h-12" aria-hidden="true" />}
                title={t('no_tabs_available')}
                description={t('no_tabs_available_desc')}
              />
            )}
            {/* Desktop / tablet: the original pill wall, untouched. */}
            {visibleTabs.length > 0 && !isPhone && (
              <div className="space-y-2">
                {renderToggle(primaryTabs)}
                {moreTabs.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => setShowMoreTabs((v) => !v)}
                      endContent={<ChevronRight className={`w-4 h-4 transition-transform ${moreExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />}
                      aria-expanded={moreExpanded}
                    >
                      {moreExpanded ? t('show_fewer_sections') : t('more_sections', { count: moreTabs.length })}
                    </Button>
                    {moreExpanded && (
                      <div className="space-y-1">
                        <p className="text-xs text-theme-subtle">{t('more_sections_caption')}</p>
                        {renderToggle(moreTabs)}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Phone: one 44px control in place of up to 16 wrapping pills (plus
                the "More (11)" disclosure that unfurled six further rows). It
                names the section you are in and opens the picker sheet. */}
            {visibleTabs.length > 0 && isPhone && (
              <>
                <Button
                  variant="flat"
                  onPress={() => setIsSectionsSheetOpen(true)}
                  aria-label={t('aria.volunteering_sections')}
                  aria-haspopup="dialog"
                  startContent={ActiveTabIcon ? <ActiveTabIcon className="w-4 h-4 shrink-0" aria-hidden="true" /> : undefined}
                  endContent={<ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  className="min-h-11 w-full justify-between rounded-xl border border-theme-default bg-theme-elevated px-3.5 text-sm font-semibold text-theme-primary sm:hidden"
                >
                  {activeTabDef?.label ?? t('aria.volunteering_sections')}
                </Button>
                <VolunteeringSectionsSheet
                  isOpen={isSectionsSheetOpen}
                  onClose={() => setIsSectionsSheetOpen(false)}
                  sections={visibleTabs.map(({ key, label }) => ({ key, label }))}
                  activeSection={activeTab ?? ''}
                  onSelect={(key) => {
                    const nextVolunteerTab = key as VolunteerTab;
                    if (VOLUNTEER_TABS.includes(nextVolunteerTab)) setTab(nextVolunteerTab);
                  }}
                />
              </>
            )}

            {/* Tab Content — wrapped in a keyed ErrorBoundary so a render error in
                any single tab (eager OR lazy) is contained to the tab instead of
                blanking the whole page; the key resets the boundary when the user
                switches tabs. */}
            {activeTab && <ErrorBoundary key={activeTab}><div>
              {activeTab === 'opportunities' && isTabEnabled('opportunities') && <OpportunitiesTab isPhone={isPhone} showMobileControls={showMobileControls} />}
              {activeTab === 'applications' && isTabEnabled('applications') && <ApplicationsTab />}
              {activeTab === 'hours' && isTabEnabled('hours') && <HoursTab />}
              <Suspense fallback={<div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12"><Spinner size="lg" /></div>}>
                {activeTab === 'recommended' && isTabEnabled('recommended') && <RecommendedShiftsTab />}
                {activeTab === 'certificates' && isTabEnabled('certificates') && <CertificatesTab />}
                {activeTab === 'alerts' && isTabEnabled('alerts') && <EmergencyAlertsTab />}
                {activeTab === 'wellbeing' && isTabEnabled('wellbeing') && <WellbeingTab />}
                {activeTab === 'credentials' && isTabEnabled('credentials') && <CredentialVerificationTab />}
                {activeTab === 'waitlist' && isTabEnabled('waitlist') && <WaitlistTab />}
                {activeTab === 'swaps' && isTabEnabled('swaps') && <ShiftSwapsTab />}
                {activeTab === 'group-signups' && isTabEnabled('group-signups') && <GroupSignUpTab />}
                {activeTab === 'expenses' && isTabEnabled('expenses') && <ExpensesTab />}
                {activeTab === 'safeguarding' && isTabEnabled('safeguarding') && <SafeguardingTab />}
                {activeTab === 'community-projects' && isTabEnabled('community-projects') && <CommunityProjectsTab />}
                {activeTab === 'donations' && isTabEnabled('donations') && <DonationsTab />}
                {activeTab === 'accessibility' && isTabEnabled('accessibility') && <AccessibilityTab />}
              </Suspense>
            </div></ErrorBoundary>}
          </>
        );
      })()}
    </div>
  );
}

/* ───────────────────────── Opportunities Tab ───────────────────────── */

interface OpportunityFilterValues {
  search: string;
  format: VolunteeringFormat;
  proximity: ProximityFilterParams | null;
}

/**
 * Single source of truth for filter → API params. The list fetch (and anything
 * else that ever needs to describe the same filters, e.g. a count probe if the
 * endpoint gains a total) must go through here so they cannot drift apart.
 * `per_page` and `cursor` stay with the caller — they are pagination, not filters.
 */
function buildOpportunityQueryParams(f: OpportunityFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set('search', f.search.trim());
  if (f.format === 'remote') params.set('is_remote', '1');
  if (f.proximity) {
    params.set('near_lat', String(f.proximity.near_lat));
    params.set('near_lng', String(f.proximity.near_lng));
    params.set('radius_km', String(f.proximity.radius_km));
  }
  return params;
}

interface OpportunitiesTabProps {
  /** Phone viewport — owns the sticky bar / sheet branch. Resolved by the page. */
  isPhone: boolean;
  /** `useHeaderScroll(64).isUtilityBarVisible`, lifted so there is one listener. */
  showMobileControls: boolean;
}

function OpportunitiesTab({ isPhone, showMobileControls }: OpportunitiesTabProps) {
  // 'volunteering' stays the default namespace (bare keys are unchanged); 'common'
  // is declared so the shared radius labels resolve explicitly.
  const { t } = useTranslation(['volunteering', 'common']);
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [proximityParams, setProximityParams] = useState<ProximityFilterParams | null>(null);
  // Phone-only dimension: the desktop filter row has no format control, so this
  // is cleared whenever the viewport leaves phone width (see the effect below)
  // rather than being left applied with no way to see or clear it.
  const [format, setFormat] = useState<VolunteeringFormat>('any');
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [, setCursor] = useState<string | undefined>();
  const cursorRef = useRef<string | undefined>(undefined);
  const tRef = useRef(t);
  tRef.current = t;
  const abortOpportunitiesRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input so we don't fire an API request on every keystroke
  // (same pattern as OrganisationsPage)
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Apply modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const guardianModal = useDisclosure();
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [applyMessage, setApplyMessage] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const loadOpportunities = useCallback(async (append = false) => {
    abortOpportunitiesRef.current?.abort();
    const controller = new AbortController();
    abortOpportunitiesRef.current = controller;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = buildOpportunityQueryParams({
        search: debouncedQuery,
        format,
        proximity: proximityParams,
      });
      params.set('per_page', '20');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<Opportunity[]>(
        `/v2/volunteering/opportunities?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = extractCollectionItems<Opportunity>(response.data);

        if (append) {
          setOpportunities((prev) => [...prev, ...items]);
        } else {
          setOpportunities(items);
        }
        setHasMore(response.meta?.has_more ?? false);
        const newCursor = response.meta?.cursor ?? undefined;
        cursorRef.current = newCursor;
        setCursor(newCursor);
      } else {
        if (!append) setError(tRef.current('error_load_opportunities'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load opportunities', err);
      if (!append) setError(tRef.current('error_load_opportunities_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery, proximityParams, format]);

  const loadOpportunitiesRef = useRef(loadOpportunities);
  loadOpportunitiesRef.current = loadOpportunities;

  useEffect(() => {
    cursorRef.current = undefined;
    setCursor(undefined);
    loadOpportunitiesRef.current();
    return () => { abortOpportunitiesRef.current?.abort(); };
  }, [debouncedQuery, proximityParams, format]);

  // Leaving phone width strands `format`: the desktop filter row has no control
  // for it and no applied-chip row to remove it from. Clear it instead of
  // silently filtering. A no-op on desktop mount (already 'any').
  useEffect(() => {
    if (!isPhone) setFormat('any');
  }, [isPhone]);

  // ── Phone filter sheet (draft — nothing applies until the footer is pressed) ──
  const commitDraftFilters = useCallback((next: VolunteeringFilterDraft) => {
    setProximityParams(next.proximity);
    setFormat(next.format);
  }, []);

  // No `countFor`: this endpoint's meta has no total (respondWithCollection),
  // so the hook never fetches and the footer reads "Show results".
  const filterSheet = useFilterDraft<VolunteeringFilterDraft>({
    onApply: commitDraftFilters,
    emptyDraft: EMPTY_VOLUNTEERING_FILTER_DRAFT,
  });
  const { open: openDraft } = filterSheet;

  const openFilterSheet = useCallback(() => {
    openDraft({ proximity: proximityParams, format });
  }, [openDraft, proximityParams, format]);

  // "Clear all" in the sticky bar clears the search too (parity with Listings),
  // even though the query is shown in the search pill rather than as a chip.
  const resetPhoneFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    setProximityParams(null);
    setFormat('any');
  }, []);

  // Removable chips for every applied filter. Search is deliberately absent —
  // it belongs in the search pill / overlay, not the chip row.
  const phoneFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (proximityParams) {
      chips.push({
        key: 'near',
        label: t(`common:radius_${proximityParams.radius_km}`, { defaultValue: `${proximityParams.radius_km} km` }),
        onRemove: () => setProximityParams(null),
      });
    }
    if (format === 'remote') {
      chips.push({ key: 'format', label: t('remote'), onRemove: () => setFormat('any') });
    }
    return chips;
  }, [proximityParams, format, t]);

  const handleApply = async () => {
    if (!selectedOpportunity) return;

    try {
      setIsApplying(true);
      const response = await api.post(`/v2/volunteering/opportunities/${selectedOpportunity.id}/apply`, {
        message: applyMessage || undefined,
      });

      if (response.success) {
        toast.success(t('applied_success'));
        onClose();
        setApplyMessage('');
        setSelectedOpportunity(null);
        loadOpportunities();
      } else if (response.code === 'GUARDIAN_CONSENT_REQUIRED') {
        onClose();
        guardianModal.onOpen();
      } else {
        toast.error(response.error || t('apply_error'));
      }
    } catch (err) {
      logError('Failed to apply', err);
      toast.error(t('apply_error'));
    } finally {
      setIsApplying(false);
    }
  };

  const openApplyModal = (opp: Opportunity) => {
    setSelectedOpportunity(opp);
    setApplyMessage('');
    onOpen();
  };

  return (
    <>
      {/* Search + Proximity (desktop and tablet — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchField
            placeholder={t('search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('search_placeholder')}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />
        </div>
        <Suspense fallback={null}>
          <LazyProximityFilter value={proximityParams} onFilter={setProximityParams} />
        </Suspense>
      </div>
      )}

      {/* Phone: slim sticky control bar — auto-hides on scroll down. Only the
          `search` placeholder is overridden; every other label falls back to the
          shared common:filter_bar.* vocabulary. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="rose"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchQuery}
          onFiltersPress={openFilterSheet}
          chips={phoneFilterChips}
          onClearAll={resetPhoneFilters}
          labels={{ search: t('search_placeholder') }}
          testId="volunteering-filter-bar"
        />
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchQuery}
          onValueChange={setSearchQuery}
          onSubmit={(value) => setDebouncedQuery(value)}
          placeholder={t('search_placeholder')}
          recentKey="volunteering"
        />
      )}

      {/* Phone filter sheet — chips on a draft, applied only by the footer. */}
      {isPhone && filterSheet.draft && (
        <VolunteeringFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
        />
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load_opportunities')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className={VOL_GRADIENT}
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadOpportunities()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Opportunities List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-4" aria-busy="true" aria-label={t('loading')}>
              {[1, 2, 3].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : opportunities.length === 0 ? (
            <EmptyState
              icon={<Briefcase className="w-12 h-12" aria-hidden="true" />}
              title={t('no_opportunities_found')}
              description={(searchQuery || proximityParams || format !== 'any') ? t('try_different_search') : t('no_opportunities_available')}
            />
          ) : (
            <div className="space-y-4">
              {opportunities.map((opp) => (
                <motion.div key={opp.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <OpportunityCard
                    opportunity={opp}
                    onApply={isAuthenticated && !opp.has_applied ? () => openApplyModal(opp) : undefined}
                  />
                </motion.div>
              ))}

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="secondary"
                    className="bg-theme-elevated text-theme-muted"
                    isLoading={isLoadingMore}
                    onPress={() => loadOpportunities(true)}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Apply Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('apply_to_volunteer')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            {selectedOpportunity && (
              <div>
                <h3 className="font-semibold text-theme-primary">{selectedOpportunity.title}</h3>
                <p className="text-sm text-theme-muted">{selectedOpportunity.organization.name}</p>
              </div>
            )}
            <Textarea
              label={t('cover_message_label')}
              placeholder={t('cover_message_placeholder')}
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} className="text-theme-muted">{t('cancel')}</Button>
            <Button
              className={VOL_GRADIENT}
              onPress={handleApply}
              isLoading={isApplying}
            >
              {t('submit_application')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {guardianModal.isOpen && (
        <Suspense fallback={null}>
          <GuardianConsentModal
            isOpen={guardianModal.isOpen}
            onOpenChange={guardianModal.onOpenChange}
            onClose={guardianModal.onClose}
            opportunityId={selectedOpportunity?.id}
          />
        </Suspense>
      )}
    </>
  );
}

/* ───────────────────────── Opportunity Card ───────────────────────── */

interface OpportunityCardProps {
  opportunity: Opportunity;
  onApply?: () => void;
}

function OpportunityCard({ opportunity, onApply }: OpportunityCardProps) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const startDate = opportunity.start_date ? new Date(opportunity.start_date) : null;
  const endDate = opportunity.end_date ? new Date(opportunity.end_date) : null;
  const categoryName = getOpportunityCategoryName(opportunity.category);

  return (
    <GlassCard className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Link to={tenantPath(`/organisations/${opportunity.organization.id}`)}>
              <Avatar
                name={opportunity.organization.name}
                src={opportunity.organization.logo_url ?? undefined}
                size="sm"
                className="flex-shrink-0"
              />
            </Link>
            <div className="min-w-0">
              <Link
                to={tenantPath(`/volunteering/opportunities/${opportunity.id}`)}
                className="font-semibold text-theme-primary text-lg truncate block hover:text-accent transition-colors"
              >
                {opportunity.title}
              </Link>
              <Link
                to={tenantPath(`/organisations/${opportunity.organization.id}`)}
                className="text-sm text-theme-muted hover:text-accent hover:underline transition-colors"
              >
                {opportunity.organization.name}
              </Link>
            </div>
          </div>

          {opportunity.description && (
            <p className="text-sm text-theme-muted mb-3 line-clamp-2">{opportunity.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle">
            {opportunity.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                {opportunity.location}
              </span>
            )}
            {opportunity.distance_km !== undefined && (
              <span className="flex items-center gap-1 text-accent font-medium">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                {opportunity.distance_km < 1
                  ? t('distance_m', { value: Math.round(opportunity.distance_km * 1000) })
                  : t('distance_km', { value: opportunity.distance_km.toFixed(1) })}
              </span>
            )}
            {opportunity.is_remote && (
              <Chip size="sm" variant="soft" color="accent" startContent={<Globe className="w-3 h-3" aria-hidden="true" />}>
                {t('remote')}
              </Chip>
            )}
            {startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" aria-hidden="true" />
                {startDate.toLocaleDateString(getFormattingLocale())}
                {endDate ? `${t('date_range_separator')}${endDate.toLocaleDateString(getFormattingLocale())}` : ''}
              </span>
            )}
            {categoryName && (
              <Chip size="sm" variant="soft" className="text-theme-subtle">
                {categoryName}
              </Chip>
            )}
            {opportunity.skills_needed && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" aria-hidden="true" />
                {opportunity.skills_needed}
              </span>
            )}
          </div>

          {opportunity.has_applied && (
            <Chip size="sm" color="success" variant="soft" className="mt-2" startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}>
              {t('applied')}
            </Chip>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-shrink-0">
          <Button
            size="sm"
            variant="tertiary"
            className="text-theme-muted w-full sm:w-auto"
            onPress={() => navigate(tenantPath(`/volunteering/opportunities/${opportunity.id}`))}
            endContent={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
          >
            {t('view_details')}
          </Button>
          {onApply && (
            <Button
              size="sm"
              className={`${VOL_GRADIENT} w-full sm:w-auto`}
              onPress={onApply}
              endContent={<Send className="w-4 h-4" aria-hidden="true" />}
            >
              {t('apply')}
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/* ───────────────────────── Applications Tab ───────────────────────── */

function ApplicationsTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { tenantPath } = useTenant();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [hasMore, setHasMore] = useState(false);
  const [, setCursor] = useState<string | undefined>();
  const cursorRef = useRef<string | undefined>(undefined);
  const tRef = useRef(t);
  tRef.current = t;
  const abortApplicationsRef = useRef<AbortController | null>(null);

  const loadApplications = useCallback(async (append = false) => {
    abortApplicationsRef.current?.abort();
    const controller = new AbortController();
    abortApplicationsRef.current = controller;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);
      if (statusFilter) params.set('status', statusFilter);

      const response = await api.get<Application[]>(
        `/v2/volunteering/applications?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = extractCollectionItems<Application>(response.data);

        if (append) {
          setApplications((prev) => [...prev, ...items]);
        } else {
          setApplications(items);
        }
        setHasMore(response.meta?.has_more ?? false);
        const newCursor = response.meta?.cursor ?? undefined;
        cursorRef.current = newCursor;
        setCursor(newCursor);
      } else {
        if (!append) setError(tRef.current('error_load_applications'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load applications', err);
      if (!append) setError(tRef.current('error_load_applications_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [statusFilter]);

  const loadApplicationsRef = useRef(loadApplications);
  loadApplicationsRef.current = loadApplications;

  useEffect(() => {
    cursorRef.current = undefined;
    setCursor(undefined);
    loadApplicationsRef.current();
    return () => { abortApplicationsRef.current?.abort(); };
  }, [statusFilter]);

  const handleWithdraw = async (applicationId: number) => {
    try {
      const response = await api.delete(`/v2/volunteering/applications/${applicationId}`);
      if (response.success) {
        toast.success(t('withdraw_success'));
        loadApplications();
      } else {
        toast.error(response.error || t('withdraw_failed'));
      }
    } catch (err) {
      logError('Failed to withdraw application', err);
      toast.error(t('withdraw_failed'));
    }
  };

  return (
    <>
      {/* Status Filter */}
      <ToggleButtonGroup
        isDetached
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        selectedKeys={new Set([statusFilter || 'all'])}
        onSelectionChange={(keys) => {
          const [next] = Array.from(keys as Set<Key>);
          if (next != null) {
            setStatusFilter(String(next) === 'all' ? '' : String(next));
          }
        }}
        className="flex gap-2 flex-wrap"
        aria-label={t('filter_by_status')}
      >
        {[
          { id: 'all', label: t('filter_all') },
          { id: 'pending', label: t('status_pending') },
          { id: 'approved', label: t('status_approved') },
          { id: 'declined', label: t('status_declined') },
        ].map(({ id, label }) => (
          <ToggleButton
            key={id}
            id={id}
            className={(statusFilter || 'all') === id ? VOL_GRADIENT : 'bg-theme-elevated text-theme-muted'}
          >
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className={VOL_GRADIENT}
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadApplications()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Applications List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-4" aria-busy="true" aria-label={t('loading')}>
              {[1, 2, 3].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : applications.length === 0 ? (
            <EmptyState
              icon={<Send className="w-12 h-12" aria-hidden="true" />}
              title={t('no_applications')}
              description={statusFilter ? t('no_status_applications', { status: t(`status_${statusFilter}`, { defaultValue: statusFilter }) }) : t('no_applications_yet')}
              action={!statusFilter ? (
                <Button
                  as={Link}
                  to={tenantPath('/volunteering')}
                  variant="secondary"
                  startContent={<Briefcase className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('applications_empty_cta')}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-4">
              {applications.map((app) => (
                <motion.div key={app.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <GlassCard className="p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Link to={tenantPath(`/volunteering/opportunities/${app.opportunity.id}`)} className="font-semibold text-theme-primary hover:text-accent transition-colors">{app.opportunity.title}</Link>
                          <Chip
                            size="sm"
                            color={statusColor(app.status)}
                            variant="soft"
                            startContent={statusIcon(app.status)}
                          >
                            {app.status === 'approved'
                              ? t('status_approved')
                              : app.status === 'declined'
                                ? t('status_declined')
                                : t('status_pending')}
                          </Chip>
                        </div>

                        <Link
                          to={tenantPath(`/organisations/${app.organization.id}`)}
                          className="text-sm text-theme-muted hover:text-accent hover:underline transition-colors mb-2 inline-flex items-center gap-1"
                        >
                          <Building2 className="w-3 h-3" aria-hidden="true" />
                          {app.organization.name}
                        </Link>

                        {app.opportunity.location && (
                          <p className="text-xs text-theme-subtle flex items-center gap-1 mb-1">
                            <MapPin className="w-3 h-3" aria-hidden="true" />
                            {app.opportunity.location}
                          </p>
                        )}

                        {app.shift && (
                          <p className="text-xs text-theme-subtle flex items-center gap-1 mb-1">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {new Date(app.shift.start_time).toLocaleString(getFormattingLocale())} - {new Date(app.shift.end_time).toLocaleTimeString(getFormattingLocale())}
                          </p>
                        )}

                        {(app.status === 'approved' || app.status === 'declined') && app.org_note && (
                          <p className="text-xs text-theme-muted flex items-start gap-1 mt-1">
                            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-theme-subtle" aria-hidden="true" />
                            <span><span className="text-theme-subtle">{t('organiser_note')} </span>{app.org_note}</span>
                          </p>
                        )}

                        <p className="text-xs text-theme-subtle mt-2">
                          {t('applied_on', { date: new Date(app.created_at).toLocaleDateString(getFormattingLocale()) })}
                        </p>
                      </div>

                      {app.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="danger-soft"
                          onPress={() => handleWithdraw(app.id)}
                        >
                          {t('withdraw')}
                        </Button>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              ))}

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="secondary"
                    className="bg-theme-elevated text-theme-muted"
                    isLoading={isLoadingMore}
                    onPress={() => loadApplications(true)}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ───────────────────────── Hours Tab ───────────────────────── */

function HoursTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [summary, setSummary] = useState<HoursSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organisations, setOrganisations] = useState<Organization[]>([]);

  // Log hours modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [logForm, setLogForm] = useState({
    organization_id: '',
    date: localCalendarDate(),
    hours: '',
    description: '',
  });
  const [isLogging, setIsLogging] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const loadSummary = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const [summaryRes, applicationsRes, myOrgsRes] = await Promise.all([
        api.get<HoursSummary>('/v2/volunteering/hours/summary'),
        api.get<unknown>('/v2/volunteering/applications?status=approved&per_page=50'),
        api.get<unknown>('/v2/volunteering/my-organisations?per_page=50'),
      ]);

      if (controller.signal.aborted) return;

      if (summaryRes.success && summaryRes.data) {
        setSummary(summaryRes.data);
      } else {
        setError(tRef.current('error_load_hours'));
      }

      const eligibleOrganisations = new Map<number, Organization>();

      if (applicationsRes.success && applicationsRes.data) {
        extractCollectionItems<Application>(applicationsRes.data).forEach((application) => {
          if (application.status === 'approved' && application.organization?.id) {
            eligibleOrganisations.set(application.organization.id, application.organization);
          }
        });
      }

      if (myOrgsRes.success && myOrgsRes.data) {
        extractCollectionItems<Organization>(myOrgsRes.data)
          .filter((org) => ['approved', 'active'].includes(org.status ?? ''))
          .forEach((org) => {
            eligibleOrganisations.set(org.id, org);
          });
      }

      setOrganisations(Array.from(eligibleOrganisations.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load hours summary', err);
      setError(tRef.current('error_load_hours_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadSummaryRef = useRef(loadSummary);
  loadSummaryRef.current = loadSummary;

  useEffect(() => {
    loadSummaryRef.current();
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleOpenLogHours = () => {
    setLogForm((prev) => ({
      ...prev,
      organization_id: prev.organization_id || (organisations.length === 1 ? String(organisations[0]?.id ?? '') : ''),
      date: prev.date || localCalendarDate(),
    }));
    onOpen();
  };

  const handleLogHours = async () => {
    if (!logForm.hours || !logForm.date || !logForm.organization_id) return;

    // Client-side guard (server stays authoritative): a single logged entry must
    // be a number between 0.25 and 24 hours. Blocks NaN and out-of-range values
    // before they hit the API and come back as a generic 422.
    const hoursNum = parseFloat(logForm.hours);
    if (Number.isNaN(hoursNum) || hoursNum < 0.25 || hoursNum > 24) {
      toast.error(t('hours_invalid_range'));
      return;
    }

    try {
      setIsLogging(true);
      const response = await api.post('/v2/volunteering/hours', {
        organization_id: parseInt(logForm.organization_id, 10),
        date: logForm.date,
        hours: hoursNum,
        description: logForm.description || undefined,
      });

      if (response.success) {
        toast.success(t('hours_logged_success'));
        onClose();
        setLogForm({ organization_id: '', date: localCalendarDate(), hours: '', description: '' });
        loadSummary();
      } else {
        toast.error(response.error || t('hours_log_failed'));
      }
    } catch (err) {
      logError('Failed to log hours', err);
      toast.error(t('hours_log_failed'));
    } finally {
      setIsLogging(false);
    }
  };

  const totalHours = (summary?.total_verified ?? 0) + (summary?.total_pending ?? 0);

  return (
    <>
      {/* Log Hours Button */}
      <div className="flex justify-end">
        <Button
          className={VOL_GRADIENT}
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={handleOpenLogHours}
          isDisabled={isLoading || organisations.length === 0}
        >
          {t('log_hours')}
        </Button>
      </div>

      {!isLoading && !error && organisations.length === 0 && (
        <GlassCard className="p-4">
          <p className="text-sm text-theme-muted">{t('no_loggable_organisations_description')}</p>
        </GlassCard>
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className={VOL_GRADIENT}
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadSummary()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Summary */}
      {!error && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
              {[1, 2, 3].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : summary ? (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <GlassCard className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-theme-primary">{summary.total_verified}</p>
                      <p className="text-xs text-theme-muted">{t('verified_hours')}</p>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <Hourglass className="w-5 h-5 text-amber-400" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-theme-primary">{summary.total_pending}</p>
                      <p className="text-xs text-theme-muted">{t('pending_hours')}</p>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-rose-400" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-theme-primary">{totalHours}</p>
                      <p className="text-xs text-theme-muted">{t('total_hours')}</p>
                    </div>
                  </div>
                </GlassCard>
              </div>

              {/* Your hours journey — makes "pending" vs "approved" obvious and
                  shows the volunteer that approval credits them automatically. */}
              <GlassCard className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-theme-primary mb-3">{t('hours_journey_title')}</h3>
                <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { n: 1, title: t('hours_journey_step1_title'), desc: t('hours_journey_step1_desc'), tone: 'bg-amber-500/10 text-amber-500' },
                    { n: 2, title: t('hours_journey_step2_title'), desc: t('hours_journey_step2_desc'), tone: 'bg-sky-500/10 text-sky-500' },
                    { n: 3, title: t('hours_journey_step3_title'), desc: t('hours_journey_step3_desc'), tone: 'bg-emerald-500/10 text-emerald-500' },
                  ].map((s) => (
                    <li key={s.n} className="flex items-start gap-3">
                      <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${s.tone}`} aria-hidden="true">{s.n}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-theme-primary">{s.title}</p>
                        <p className="text-xs text-theme-muted">{s.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </GlassCard>

              {/* Progress toward a round number goal */}
              {totalHours > 0 && (
                <GlassCard className="p-5">
                  <div className="flex justify-between text-sm text-theme-muted mb-2">
                    <span>{t('progress')}</span>
                    <span>{t('hours_of_goal', { current: totalHours, goal: Math.ceil(totalHours / 50) * 50 })}</span>
                  </div>
                  <Progress
                    value={(totalHours / (Math.ceil(totalHours / 50) * 50)) * 100}
                    classNames={{
                      indicator: VOL_GRADIENT_BASE,
                      track: 'bg-theme-hover',
                    }}
                    size="md"
                    aria-label={t('hours_progress_aria', { hours: totalHours })}
                  />
                </GlassCard>
              )}

              {/* By Organization */}
              {(summary.by_organization ?? []).length > 0 && (
                <GlassCard className="p-5">
                  <h3 className="font-semibold text-theme-primary mb-4 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-rose-400" aria-hidden="true" />
                    {t('hours_by_organization')}
                  </h3>
                  <div className="space-y-3">
                    {(summary.by_organization ?? []).map((org) => (
                      <div key={org.name} className="flex items-center justify-between">
                        <span className="text-sm text-theme-muted">{org.name}</span>
                        <span className="text-sm font-medium text-theme-primary">{t('hours_abbrev', { hours: org.hours })}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* By Month */}
              {(summary.by_month ?? []).length > 0 && (
                <GlassCard className="p-5">
                  <h3 className="font-semibold text-theme-primary mb-4 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-rose-400" aria-hidden="true" />
                    {t('hours_by_month')}
                  </h3>
                  <div className="space-y-3">
                    {(summary.by_month ?? []).map((month) => (
                      <div key={month.month} className="flex items-center justify-between">
                        <span className="text-sm text-theme-muted">
                          {formatYearMonthLabel(month.month)}
                        </span>
                        <span className="text-sm font-medium text-theme-primary">{t('hours_abbrev', { hours: month.hours })}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}

              {totalHours === 0 && (
                <EmptyState
                  icon={<Timer className="w-12 h-12" aria-hidden="true" />}
                  title={t('no_hours_logged')}
                  description={t('no_hours_description')}
                  action={
                    <Button
                      className={VOL_GRADIENT}
                      onPress={handleOpenLogHours}
                      isDisabled={organisations.length === 0}
                    >
                      {t('log_hours')}
                    </Button>
                  }
                />
              )}
            </div>
          ) : null}
        </>
      )}

      {/* Log Hours Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('log_volunteering_hours')}</ModalHeader>
          <ModalBody className="space-y-4">
            <Select
              label={t('organisation_label')}
              placeholder={t('select_organisation')}
              selectedKeys={logForm.organization_id ? new Set([logForm.organization_id]) : new Set()}
              onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setLogForm((prev) => ({ ...prev, organization_id: val })); }}
              isRequired
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
              startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            >
              {organisations.map((org) => (
                <SelectItem key={String(org.id)} id={String(org.id)}>{org.name}</SelectItem>
              ))}
            </Select>
            <Input
              type="date"
              label={t('date_label')}
              value={logForm.date}
              onChange={(e) => setLogForm((prev) => ({ ...prev, date: e.target.value }))}
              isRequired
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            <Input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              label={t('hours_label')}
              placeholder={t('hours_placeholder')}
              value={logForm.hours}
              onChange={(e) => setLogForm((prev) => ({ ...prev, hours: e.target.value }))}
              isRequired
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            <Textarea
              label={t('description_label')}
              placeholder={t('description_placeholder')}
              value={logForm.description}
              onChange={(e) => setLogForm((prev) => ({ ...prev, description: e.target.value }))}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} className="text-theme-muted">{t('cancel')}</Button>
            <Button
              className={VOL_GRADIENT}
              onPress={handleLogHours}
              isLoading={isLogging}
              isDisabled={!logForm.hours || !logForm.date || !logForm.organization_id}
            >
              {t('log_hours')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default VolunteeringPage;
