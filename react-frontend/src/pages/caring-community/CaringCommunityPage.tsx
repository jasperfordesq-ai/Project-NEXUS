// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Building2 from 'lucide-react/icons/building-2';
import Calendar from 'lucide-react/icons/calendar';
import FileText from 'lucide-react/icons/file-text';
import Globe from 'lucide-react/icons/globe';
import Heart from 'lucide-react/icons/heart';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import HelpingHand from 'lucide-react/icons/hand-helping';
import ListChecks from 'lucide-react/icons/list-checks';
import Megaphone from 'lucide-react/icons/megaphone';
import MessageSquare from 'lucide-react/icons/message-square';
import Sparkles from 'lucide-react/icons/sparkles';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Store from 'lucide-react/icons/store';
import Coins from 'lucide-react/icons/coins';
import PiggyBank from 'lucide-react/icons/piggy-bank';
import Gift from 'lucide-react/icons/gift';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import UserRoundCheck from 'lucide-react/icons/user-round-check';
import UserRoundPlus from 'lucide-react/icons/user-round-plus';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Target from 'lucide-react/icons/target';
import Users from 'lucide-react/icons/users';
import Wallet from 'lucide-react/icons/wallet';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import {
  OnboardingChoiceModal,
  clearStoredOnboardingChoice,
  readStoredOnboardingChoice,
  type OnboardingChoice,
} from '@/components/caring-community/OnboardingChoiceModal';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import type { TenantFeatures, TenantModules } from '@/types/api';

interface ActionDef {
  key: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  feature?: keyof TenantFeatures;
  module?: keyof TenantModules;
  /** Mark features that aren't fully live yet so we never imply they're ready. */
  preview?: boolean;
}

interface GroupDef {
  id: string;
  icon: ComponentType<{ className?: string }>;
  /** Optional clarifying note rendered under the group description. */
  note?: boolean;
  actions: ActionDef[];
}

/**
 * Actions are grouped by the user's intent so the hub reads as a clear set of
 * tasks rather than a flat wall of buttons. Time-credit actions are kept in one
 * group and explicitly flagged as shared with the timebank to avoid the
 * "two systems doing the same thing" confusion.
 */
const GROUPS: GroupDef[] = [
  {
    id: 'get_help',
    icon: ListChecks,
    actions: [
      { key: 'request_help', href: '/caring-community/request-help', icon: ListChecks },
      { key: 'my_relationships', href: '/caring-community/my-relationships', icon: Users, feature: 'caring_community' },
    ],
  },
  {
    id: 'give_help',
    icon: HelpingHand,
    actions: [
      { key: 'become_caregiver', href: '/caring-community/caregiver/link', icon: UserRoundPlus, feature: 'caring_community' },
      { key: 'offer_favour', href: '/caring-community/offer-favour', icon: HeartHandshake, feature: 'caring_community' },
      { key: 'offer_time', href: '/listings/create?type=offer', icon: Heart, module: 'listings' },
      { key: 'log_hours', href: '/volunteering?tab=hours', icon: Wallet, feature: 'volunteering' },
      { key: 'coordinate_org', href: '/volunteering/my-organisations', icon: Building2, feature: 'volunteering' },
    ],
  },
  {
    id: 'your_hours',
    icon: Coins,
    note: true,
    actions: [
      { key: 'hour_gift', href: '/caring-community/hour-gift', icon: Gift, feature: 'caring_community' },
      { key: 'hour_transfer', href: '/caring-community/hour-transfer', icon: ArrowRightLeft, feature: 'caring_community' },
      { key: 'loyalty_history', href: '/caring-community/loyalty/history', icon: Coins, feature: 'caring_community' },
      { key: 'future_care_fund', href: '/caring-community/future-care-fund', icon: PiggyBank, feature: 'caring_community' },
      { key: 'markt', href: '/caring-community/markt', icon: Store, feature: 'caring_community' },
    ],
  },
  {
    id: 'caregiver_tools',
    icon: UserRoundCheck,
    actions: [
      { key: 'cover_care', href: '/caring-community/caregiver/cover', icon: UserRoundCheck, feature: 'caring_community', preview: true },
    ],
  },
  {
    id: 'safety',
    icon: ShieldAlert,
    actions: [
      { key: 'safeguarding_report', href: '/caring-community/safeguarding/report', icon: ShieldAlert, feature: 'caring_community' },
      { key: 'projects', href: '/caring-community/projects', icon: Megaphone, feature: 'caring_community' },
    ],
  },
];

const moduleCards: ActionDef[] = [
  { key: 'timebank', href: '/listings', icon: ListChecks, module: 'listings' },
  { key: 'volunteering', href: '/volunteering', icon: Heart, feature: 'volunteering' },
  { key: 'organisations', href: '/organisations', icon: Building2, feature: 'volunteering' },
  { key: 'events', href: '/events', icon: Calendar, feature: 'events' },
  { key: 'groups', href: '/groups', icon: Users, feature: 'groups' },
  { key: 'resources', href: '/resources', icon: FileText, feature: 'resources' },
  { key: 'goals', href: '/goals', icon: Target, feature: 'goals' },
  { key: 'federation', href: '/federation', icon: Globe, feature: 'federation' },
  { key: 'clubs', href: '/clubs', icon: ShoppingBag },
  { key: 'messages', href: '/messages', icon: MessageSquare, module: 'messages' },
  { key: 'trust', href: '/verify-identity', icon: ShieldCheck },
];

function isVisible(
  item: ActionDef,
  hasFeature: (feature: keyof TenantFeatures) => boolean,
  hasModule: (module: keyof TenantModules) => boolean,
): boolean {
  if (item.feature && !hasFeature(item.feature)) return false;
  if (item.module && !hasModule(item.module)) return false;
  return true;
}

export function CaringCommunityPage() {
  const { t } = useTranslation(['common', 'caring_community']);
  const { branding, hasFeature, hasModule, tenant, tenantPath, tenantSlug } = useTenant();
  usePageTitle(t('caring_community.meta.title'));

  const onboardingTenantScope = tenant?.slug ?? tenantSlug ?? (tenant?.id ? String(tenant.id) : null);
  const [choice, setChoice] = useState<OnboardingChoice | null>(() => readStoredOnboardingChoice(onboardingTenantScope));
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  // Open the modal once on first mount when no stored choice exists.
  useEffect(() => {
    const storedChoice = readStoredOnboardingChoice(onboardingTenantScope);
    setChoice(storedChoice);
    if (storedChoice === null) {
      setModalOpen(true);
    }
  }, [onboardingTenantScope]);

  const handleChoice = useCallback((picked: OnboardingChoice) => {
    setChoice(picked);
    setModalOpen(false);
  }, []);

  const handleRefine = useCallback(() => {
    clearStoredOnboardingChoice(onboardingTenantScope);
    setChoice(null);
    setModalOpen(true);
  }, [onboardingTenantScope]);

  // The hero's primary call-to-action follows what the visitor told us they're here for.
  const primaryCta = choice === 'helper' ? 'give' : 'get';

  const visibleGroups = useMemo(
    () =>
      GROUPS
        .map((group) => ({ ...group, actions: group.actions.filter((a) => isVisible(a, hasFeature, hasModule)) }))
        .filter((group) => group.actions.length > 0),
    [hasFeature, hasModule],
  );

  const visibleCards = useMemo(
    () => moduleCards.filter((item) => isVisible(item, hasFeature, hasModule)),
    [hasFeature, hasModule],
  );

  return (
    <>
      <PageMeta
        title={t('caring_community.meta.title')}
        description={t('caring_community.meta.description')}
      />

      <OnboardingChoiceModal
        isOpen={modalOpen}
        onChoice={handleChoice}
        onClose={() => setModalOpen(false)}
        tenantScope={onboardingTenantScope}
      />

      <div className="mx-auto max-w-5xl space-y-8">
        {/* ── Hero: what this is, in plain words, and that it's brand new ── */}
        <GlassCard className="overflow-hidden p-0">
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50/40 p-6 dark:from-emerald-950/40 dark:to-teal-950/20 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Chip color="warning" variant="flat" size="sm" startContent={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}>
                {t('caring_community.alpha.badge')}
              </Chip>
              <Chip color="primary" variant="flat" size="sm">
                {branding.name}
              </Chip>
            </div>

            <h1 className="mt-4 text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              {t('caring_community.hero.title')}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-8 text-theme-muted">
              {t('caring_community.hero.intro')}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-theme-muted">
              {t('caring_community.hero.timebank_note')}
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {primaryCta === 'get' ? (
                <>
                  <Button as={Link} to={tenantPath('/caring-community/request-help')} className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white" startContent={<ListChecks className="h-4 w-4" aria-hidden="true" />}>
                    {t('caring_community.hero.cta_get_help')}
                  </Button>
                  <Button as={Link} to={tenantPath('/volunteering')} variant="tertiary" startContent={<HelpingHand className="h-4 w-4" aria-hidden="true" />}>
                    {t('caring_community.hero.cta_give_help')}
                  </Button>
                </>
              ) : (
                <>
                  <Button as={Link} to={tenantPath('/volunteering')} className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white" startContent={<HelpingHand className="h-4 w-4" aria-hidden="true" />}>
                    {t('caring_community.hero.cta_give_help')}
                  </Button>
                  <Button as={Link} to={tenantPath('/caring-community/request-help')} variant="tertiary" startContent={<ListChecks className="h-4 w-4" aria-hidden="true" />}>
                    {t('caring_community.hero.cta_get_help')}
                  </Button>
                </>
              )}
              {choice !== null && (
                <Button size="sm" variant="light" onPress={handleRefine} className="sm:ml-auto">
                  {t('caring_community:onboarding.change_answer')}
                </Button>
              )}
            </div>
          </div>

          {/* Honest "this is new" notice — set expectations, don't oversell */}
          <div className="border-t border-amber-200/60 bg-amber-50/70 px-6 py-4 dark:border-amber-900/40 dark:bg-amber-950/20 sm:px-8">
            <p className="text-sm leading-7 text-amber-900 dark:text-amber-200">
              <span className="font-semibold">{t('caring_community.new_notice.title')}</span>{' '}
              {t('caring_community.new_notice.body')}
            </p>
          </div>
        </GlassCard>

        {/* ── How it works: three plain steps ── */}
        <section>
          <h2 className="text-xl font-semibold text-theme-primary">{t('caring_community.how.title')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('caring_community.how.subtitle')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {['step1', 'step2', 'step3'].map((step, i) => (
              <div key={step} className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  {i + 1}
                </div>
                <p className="mt-3 text-sm font-semibold text-theme-primary">
                  {t(`caring_community.how.${step}_title`)}
                </p>
                <p className="mt-1 text-xs leading-6 text-theme-muted">
                  {t(`caring_community.how.${step}_desc`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── We need caregivers: honest recruitment, not a pretend roster ── */}
        {hasFeature('caring_community') && (
          <GlassCard className="border-emerald-200/60 bg-emerald-50/50 p-6 dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                  <UserRoundPlus className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-theme-primary">{t('caring_community.recruit.title')}</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-7 text-theme-muted">{t('caring_community.recruit.body')}</p>
                </div>
              </div>
              <Button as={Link} to={tenantPath('/volunteering')} className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-white" startContent={<HelpingHand className="h-4 w-4" aria-hidden="true" />}>
                {t('caring_community.recruit.cta')}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* ── Grouped actions ── */}
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          return (
            <section key={group.id}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-400">
                  <GroupIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-theme-primary">
                    {t(`caring_community.groups.${group.id}.title`)}
                  </h2>
                  <p className="text-sm text-theme-muted">{t(`caring_community.groups.${group.id}.desc`)}</p>
                </div>
              </div>

              {group.note && (
                <p className="mt-2 rounded-lg border border-theme-default bg-theme-elevated px-3 py-2 text-xs leading-6 text-theme-muted">
                  {t('caring_community.your_hours_note')}
                </p>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.actions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.key}
                      as={Link}
                      to={tenantPath(item.href)}
                      className="group min-h-28 w-full min-w-0 flex-col items-start justify-between gap-3 whitespace-normal bg-theme-elevated px-4 py-4 text-theme-primary transition-colors hover:bg-[var(--color-surface-hover)]"
                      variant="tertiary"
                    >
                      <span className="flex w-full min-w-0 items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="flex min-w-0 flex-col text-left">
                          <span className="flex items-center gap-2 text-sm font-semibold leading-5 break-words">
                            {t(`caring_community.actions.${item.key}`)}
                            {item.preview && (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-theme-warning">
                                {t('caring_community.preview_tag')}
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="flex w-full min-w-0 items-end justify-between gap-3">
                        <span className="block min-w-0 text-left text-xs font-normal leading-5 break-words text-theme-muted">
                          {t(`caring_community.actions.${item.key}_sub`)}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-theme-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]" aria-hidden="true" />
                      </span>
                    </Button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* ── The rest of the community ── */}
        <section>
          <h2 className="text-xl font-semibold text-theme-primary">{t('caring_community.modules.title')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('caring_community.modules.subtitle')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleCards.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  to={tenantPath(item.href)}
                  className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
                  aria-label={t(`caring_community.modules.${item.key}.title`)}
                >
                  <GlassCard className="h-full p-5 transition-transform group-hover:-translate-y-0.5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-500/15">
                        <Icon className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-theme-primary">
                          {t(`caring_community.modules.${item.key}.title`)}
                        </h3>
                        <p className="mt-1 text-sm leading-6 break-words text-theme-muted">
                          {t(`caring_community.modules.${item.key}.description`)}
                        </p>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)]">
                          {t('caring_community.modules.open')}
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

export default CaringCommunityPage;
