// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Sparkles from 'lucide-react/icons/sparkles';
import Globe from 'lucide-react/icons/globe';
import Shield from 'lucide-react/icons/shield';
import Github from 'lucide-react/icons/github';
import Bug from 'lucide-react/icons/bug';
import ExternalLink from 'lucide-react/icons/external-link';
import Info from 'lucide-react/icons/info';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import BookOpen from 'lucide-react/icons/book-open';
import Heart from 'lucide-react/icons/heart';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { SearchField } from '@/components/ui/SearchField';
import { Separator } from '@/components/ui/Separator';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';
import featuresCatalogue from '@/data/featuresCatalogue.json';
import { useTenant } from '@/contexts';
/**
 * Features Page
 *
 * Public marketing page documenting every module shipped in Project NEXUS
 * v1.5 (GA). Each module is honestly labelled with its maturity:
 *
 *   - (unmarked)  General Availability — stable, supported, used in production
 *   - Beta        Working in production, surface still hardening
 *   - Preview     Recently shipped, available to opt in, may change
 *   - Dormant     Built and tested, switched off by default, not in use
 *
 * `dormant` was added on 2026-07-30 because the first three labels all assert
 * production USE — GA says "used in production", Beta says "working in
 * production today". External partner federation is complete and tested but has
 * been switched off platform-wide since the 2026-07-27 deploy, with no partner
 * connected and zero external callers in twelve weeks of access logs. Labelled
 * `beta`, it had acquired a description claiming real partnerships exchanging
 * data daily, on a page whose own subheading promises honest labelling. The
 * vocabulary had no way to say "we built this, it works, nobody needs it yet",
 * so the copy drifted into claiming the opposite. Use `dormant` for any
 * capability that is finished but deliberately not switched on.
 *
 * 🔴 Federation is TWO different things and the labels must keep them apart.
 * Internal cross-tenant federation (communities on one installation) is live and
 * ungated by design — its admin surfaces under /v2/admin/federation/* carry no
 * kill switch. External partner federation (other installations and other
 * platforms) is the dormant one. Commit b9beb929d exists because that
 * distinction had already been lost once.
 *
 * The page replaces the previous "Development Status" page; the old route
 * still redirects here so existing bookmarks survive.
 *
 * 🔴 This is a catalogue of what the SOFTWARE can do, not an inventory of what
 * any one tenant has enabled. Most items here are per-tenant feature or module
 * flags (`TenantFeatureConfig::FEATURE_DEFAULTS`), and several default to OFF —
 * courses, podcasts, marketplace, caring_community, partner_venues,
 * public_events, maps, member_premium and more. Members read the page as a
 * promise about their own site, so the availability notice under the hero is
 * load-bearing: do not remove it or demote it to a footnote.
 *
 * 🔴 Version-bearing copy lives in `features_page.meta_title`,
 * `meta_description` and `subheading` in `locales/en/public.json`. It said
 * "v1.5" for three minor releases while the release chip beside the heading —
 * which reads `RELEASE_STATUS.stageLabel` from `src/config/releaseStatus.ts` —
 * said v1.6.0. Bump both together, and add the version files listed in
 * AGENTS.md ("Version and Changelog Hygiene") to the same commit.
 */


// ---------------------------------------------------------------------------
// Maturity chip
// ---------------------------------------------------------------------------

type Maturity = 'ga' | 'beta' | 'preview' | 'dormant';

/** Sentinel for "no category chosen" in the filter chip row. */
const ALL_CATEGORIES = '__all__';

function MaturityChip({ level }: { level: Maturity }) {
  const { t } = useTranslation('public');
  if (level === 'ga') return null;
  const config: Record<Exclude<Maturity, 'ga'>, { color: 'warning' | 'accent' | 'default'; label: string }> = {
    beta: { color: 'warning', label: t('features_page.chips.beta') },
    preview: { color: 'accent', label: t('features_page.chips.preview') },
    // Neutral, not a warning: nothing is wrong with a finished capability that
    // is switched off. It is a statement of availability, not of quality.
    dormant: { color: 'default', label: t('features_page.chips.dormant') },
  };
  const { color, label } = config[level];
  return (
    <Chip color={color} variant="tertiary" size="sm" className="ms-2 align-middle">
      {label}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Feature item
// ---------------------------------------------------------------------------

interface FeatureItem {
  key: string;
  maturity?: Maturity;
}

function FeatureList({ groupKey, items }: { groupKey: string; items: FeatureItem[] }) {
  const { t, i18n } = useTranslation('public');

  return (
    <ul className="space-y-3 list-none">
      {items.map((item) => {
        const copyKey = `features_page.groups.${groupKey}.items.${item.key}`;
        const noteKey = `${copyKey}.note`;
        const note = i18n.exists(noteKey, { ns: 'public' }) ? t(noteKey) : '';

        return (
          <li key={item.key} className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-success shrink-0 mt-1" aria-hidden="true" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{t(`${copyKey}.title`)}</span>
              <MaturityChip level={item.maturity ?? 'ga'} />
              <span className="text-theme-muted"> {t(`${copyKey}.description`)}</span>
              {note && (
                <p className="text-xs text-theme-muted mt-1 italic">{note}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Search + category filtering.
 *
 * 🔴 Why filter-in-place rather than tabs or accordions: `/features` is on the
 * public prerender allowlist (see `vite.config.ts` runtimeCaching and
 * `prerender:plan-routes`), so SEO crawlers are served a snapshot of the
 * server-rendered DOM. Tab panels and collapsed accordions unmount their
 * content, which would drop most of this page out of that snapshot and out of
 * the browser's own Ctrl+F. With no query and no category chosen, every entry
 * is rendered — the filter only ever removes nodes in response to a
 * deliberate user action, so the default DOM stays complete.
 */
function useFeatureFilter(groups: FeatureGroup[]) {
  const { t, i18n } = useTranslation('public');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);

  // Match against the rendered copy, not the key names: a member searching
  // "credits" should find "Attendance Rewards", whose key says nothing about
  // credits. Notes are included so "switched off" finds the dormant entries.
  const haystack = useCallback(
    (groupKey: string, itemKey: string) => {
      const base = `features_page.groups.${groupKey}.items.${itemKey}`;
      const noteKey = `${base}.note`;
      const note = i18n.exists(noteKey, { ns: 'public' }) ? t(noteKey) : '';
      return `${t(`${base}.title`)} ${t(`${base}.description`)} ${note}`.toLowerCase();
    },
    [t, i18n]
  );

  const normalisedQuery = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return groups
      .filter((group) => category === ALL_CATEGORIES || group.key === category)
      .map((group) => ({
        ...group,
        items: normalisedQuery
          ? group.items.filter((item) => haystack(group.key, item.key).includes(normalisedQuery))
          : group.items,
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, category, normalisedQuery, haystack]);

  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const shown = visible.reduce((n, g) => n + g.items.length, 0);
  const isFiltered = normalisedQuery !== '' || category !== ALL_CATEGORIES;

  const reset = useCallback(() => {
    setQuery('');
    setCategory(ALL_CATEGORIES);
  }, []);

  return { query, setQuery, category, setCategory, visible, total, shown, isFiltered, reset };
}

interface FeatureGroup {
  key: string;
  items: FeatureItem[];
}

function FeatureSection({
  group,
  icon,
}: {
  group: FeatureGroup;
  icon?: ReactNode;
}) {
  const { t, i18n } = useTranslation('public');
  const groupKey = `features_page.groups.${group.key}`;
  const introKey = `${groupKey}.intro`;
  const intro = i18n.exists(introKey, { ns: 'public' }) ? t(introKey) : '';

  return (
    <Card className="border border-border shadow-sm">
      <Card.Header className="flex gap-2 items-center">
        {icon}
        <h2 className="text-lg font-semibold">{t(`${groupKey}.title`)}</h2>
      </Card.Header>
      <Separator />
      <Card.Content className="space-y-3">
        {intro && <p className="text-sm text-theme-muted">{intro}</p>}
        <FeatureList groupKey={group.key} items={group.items} />
      </Card.Content>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Feature inventory
// ---------------------------------------------------------------------------

// 🔴 The catalogue is SHARED with the accessible frontend (web-uk), which renders
// the same 119 features on its own /features page. It used to be an inline array
// here, which meant the two pages could only be kept in step by hand.
//
// Group order, item order and each item's maturity live in the JSON. The TEXT does
// not: it stays in public.json under features_page.groups.*, so adding a feature
// means adding its title and description to all eleven locale files.
//
// web-uk cannot read this file at runtime (its Docker build context is web-uk/), so
// it keeps a generated copy, refreshed with `npm --prefix web-uk run build:features`
// and checked by `npm --prefix web-uk run check:features`.
const GROUPS: FeatureGroup[] = featuresCatalogue.groups as FeatureGroup[];


// Keyed by group, not positional: the old positional `icons[index]` array
// silently reassigned every icon whenever a group was added or reordered.
const GROUP_ICONS: Record<string, ReactNode> = {
  core_platform: <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />,
  federation: <Globe className="w-5 h-5 text-accent" aria-hidden="true" />,
  member_experience: <Users className="w-5 h-5 text-success" aria-hidden="true" />,
  content_and_communication: <BookOpen className="w-5 h-5 text-success" aria-hidden="true" />,
  trust_reputation_and_safety: <Shield className="w-5 h-5 text-warning" aria-hidden="true" />,
  ai_and_recommendation_engine: <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />,
  caring_community_layer: <Heart className="w-5 h-5 text-accent" aria-hidden="true" />,
  built_for_production: <Shield className="w-5 h-5 text-accent" aria-hidden="true" />,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FeaturesPage() {
  const { t } = useTranslation('public');
  const { tenantPath } = useTenant();
  usePageTitle(t('features_page.title'));

  const { query, setQuery, category, setCategory, visible, total, shown, isFiltered, reset } =
    useFeatureFilter(GROUPS);

  const categoryOptions = useMemo(
    () => [
      { key: ALL_CATEGORIES, label: t('features_page.filter_all') },
      ...GROUPS.map((group) => ({
        key: group.key,
        label: t(`features_page.groups.${group.key}.title`),
      })),
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('features_page.meta_title')}
        description={t('features_page.meta_description')}
      />

      {/* Hero */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Sparkles className="w-7 h-7 text-accent shrink-0" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {t('features_page.heading')}
          </h1>
          <Chip color="success" variant="tertiary" size="sm">
            {t('release_stage')}
          </Chip>
        </div>
        <p className="text-sm sm:text-base text-theme-muted">
          {t('features_page.subheading')}
        </p>
      </div>

      {/* Availability notice.
          Deliberately the first thing after the heading, deliberately louder
          than the maturity key below it, and deliberately written without the
          words "module", "feature flag" or "tenant". The page is a catalogue of
          what the software can do; readers kept taking it as a list of what
          their own community had switched on. HeroUI's accent Alert (not a
          hand-rolled Card) so it inherits the same notice styling and
          light/dark tokens as every other alert in the app. */}
      <Alert
        color="accent"
        role="note"
        // HeroUI's own `alert--accent` renders on a plain white surface with a
        // near-invisible 8%-black border, which is not enough for a notice this
        // page depends on being read. The tint + heavier border are added
        // explicitly; both resolve from the Tailwind accent scale that
        // `text-accent` already uses throughout the app, so it stays
        // theme-aware in light and dark.
        className="border-2 border-accent bg-accent/10"
        icon={<Info className="w-5 h-5" aria-hidden="true" />}
        classNames={{ title: 'text-base font-bold' }}
        title={t('features_page.availability_notice_title')}
        description={
          <span className="block space-y-2">
            <span className="block font-medium text-foreground">
              {t('features_page.availability_notice_body')}
            </span>
            <span className="block">
              {t('features_page.availability_notice_body_2')}
            </span>
            <span className="block">
              {t('features_page.availability_notice_body_3')}
            </span>
          </span>
        }
      />

      {/* Maturity key */}
      <Card className="border border-border shadow-sm">
        <Card.Content className="text-sm space-y-2">
          <p className="font-semibold text-foreground">
            {t('features_page.maturity_key_title')}
          </p>
          <ul className="space-y-1.5 list-none">
            <li className="flex items-start gap-2">
              <Chip color="success" variant="tertiary" size="sm" className="shrink-0">GA</Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_ga')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="warning" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.beta')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_beta')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="accent" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.preview')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_preview')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="default" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.dormant')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_dormant')}
              </span>
            </li>
          </ul>
        </Card.Content>
      </Card>

      {/* Search + category filter.
          Sits between the maturity key and the groups so the two things a
          first-time reader needs (what the page is, how the labels work) are
          still read first. */}
      <Card className="border border-border shadow-sm">
        <Card.Content className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {t('features_page.filter_heading')}
            </p>
            <p className="text-xs text-theme-muted" aria-live="polite">
              {t('features_page.results_summary', { shown, total })}
            </p>
          </div>

          <SearchField
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery('')}
            isClearable
            aria-label={t('features_page.search_label')}
            placeholder={t('features_page.search_placeholder')}
            startContent={<Search size={16} className="text-theme-muted" aria-hidden="true" />}
          />

          <FilterChipGroup
            label={t('features_page.filter_group_label')}
            ariaLabel={t('features_page.filter_group_label')}
            selected={category}
            onChange={setCategory}
            options={categoryOptions}
            extra={
              isFiltered ? (
                <button
                  type="button"
                  onClick={reset}
                  className="min-h-11 rounded-full px-3 text-sm font-medium text-accent underline focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {t('features_page.clear_filters')}
                </button>
              ) : undefined
            }
          />
        </Card.Content>
      </Card>

      {/* Feature groups */}
      {visible.map((group) => (
        <FeatureSection key={group.key} group={group} icon={GROUP_ICONS[group.key]} />
      ))}

      {visible.length === 0 && (
        <Card className="border border-border shadow-sm">
          <Card.Content className="space-y-2 py-8 text-center">
            <p className="font-semibold text-foreground">
              {t('features_page.no_results_title')}
            </p>
            <p className="text-sm text-theme-muted">
              {t('features_page.no_results_body')}
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-2 min-h-11 rounded-full px-4 text-sm font-medium text-accent underline focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {t('features_page.clear_filters')}
            </button>
          </Card.Content>
        </Card>
      )}

      {/* Modern Tech Stack */}
      <Card className="border border-border shadow-sm">
        <Card.Header>
          <h2 className="text-lg font-semibold">
            {t('features_page.tech_stack_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted">
          <ul className="grid sm:grid-cols-2 gap-y-1.5 gap-x-6 list-none">
            <li><strong>{t('features_page.tech_stack.frontend_label')}:</strong> {t('features_page.tech_stack.frontend_value')}</li>
            <li><strong>{t('features_page.tech_stack.accessible_label')}:</strong> {t('features_page.tech_stack.accessible_value')}</li>
            <li><strong>{t('features_page.tech_stack.backend_label')}:</strong> {t('features_page.tech_stack.backend_value')}</li>
            <li><strong>{t('features_page.tech_stack.database_label')}:</strong> {t('features_page.tech_stack.database_value')}</li>
            <li><strong>{t('features_page.tech_stack.search_label')}:</strong> {t('features_page.tech_stack.search_value')}</li>
            <li><strong>{t('features_page.tech_stack.ai_label')}:</strong> {t('features_page.tech_stack.ai_value')}</li>
            <li><strong>{t('features_page.tech_stack.realtime_label')}:</strong> {t('features_page.tech_stack.realtime_value')}</li>
            <li><strong>{t('features_page.tech_stack.mobile_label')}:</strong> {t('features_page.tech_stack.mobile_value')}</li>
            <li><strong>{t('features_page.tech_stack.infrastructure_label')}:</strong> {t('features_page.tech_stack.infrastructure_value')}</li>
          </ul>
        </Card.Content>
      </Card>

      {/* Open source + how to help */}
      <Card className="border border-accent dark:border-accent">
        <Card.Header className="flex gap-2 items-center">
          <Github className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {t('features_page.open_source_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted space-y-3">
          <p>
            {t('features_page.open_source_body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/jasperfordesq-ai/Project-NEXUS"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              <Github className="w-3.5 h-3.5" aria-hidden="true" />
              {t('features_page.link_repo')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <Link
              to={tenantPath('/changelog')}
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.link_changelog')}
            </Link>
            <a
              href="https://project-nexus.canny.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              <Bug className="w-3.5 h-3.5" aria-hidden="true" />
              {t('features_page.link_report_bug')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <Link
              to={tenantPath('/about')}
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.link_about')}
            </Link>
          </div>
        </Card.Content>
      </Card>

      {/* Security disclosure */}
      <Card className="border border-danger-200 dark:border-danger-800">
        <Card.Header className="flex gap-2 items-center">
          <Shield className="w-5 h-5 text-danger" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {t('features_page.security_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted">
          <p>
            {t('features_page.security_body_before')}
            <a
              href="mailto:jasper@hour-timebank.ie"
              className="text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.security_email')}
            </a>
            {t('features_page.security_body_after')}
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}

export default FeaturesPage;

