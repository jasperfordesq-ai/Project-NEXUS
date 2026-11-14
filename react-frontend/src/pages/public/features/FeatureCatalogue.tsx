// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The full list of what the software can do, one closed row per group.
 *
 * Each entry is honestly labelled with its maturity:
 *
 *   - (unmarked)  General Availability — stable, supported, used in production
 *   - Beta        Working in production, surface still hardening
 *   - Preview     Recently shipped, available to opt in, may change
 *   - Dormant     Built and tested, switched off by default, not in use
 *
 * `dormant` was added on 2026-07-30 because the first three labels all assert
 * production USE. External partner federation is complete and tested but has
 * been switched off platform-wide since the 2026-07-27 deploy, with no partner
 * connected. Labelled `beta`, it had acquired a description claiming real
 * partnerships exchanging data daily. Use `dormant` for any capability that is
 * finished but deliberately not switched on.
 *
 * 🔴 Federation is TWO different things and the labels must keep them apart.
 * Internal cross-tenant federation (communities on one installation) is live
 * and ungated by design. External partner federation (other installations and
 * other platforms) is the dormant one. Commit b9beb929d exists because that
 * distinction had already been lost once.
 *
 * 🔴 This is a catalogue of what the SOFTWARE can do, not an inventory of what
 * any one community has switched on. Most entries are per-community feature or
 * module flags (`TenantFeatureConfig::FEATURE_DEFAULTS`) and several default to
 * OFF. Members read a features page as a promise about their own site, so the
 * availability note directly above the list is load-bearing: it may be short
 * (owner, 14 Nov 2026 — the cards above it now show only what IS switched on),
 * but it must stay, and stay above the list rather than below it.
 *
 * 🔴 Closed groups must keep their entries in the DOM. `/features` is on the
 * public prerender allowlist, so search engines are served a snapshot of the
 * rendered page. HeroUI's Disclosure (React Aria `DisclosurePanel`) renders its
 * children while closed and hides them with `hidden="until-found"`, so the
 * snapshot is complete and the browser's own find-in-page opens the right
 * group by itself. Tabs, or rendering a group's list only when it is open,
 * would drop most of this page out of both. `FeaturesPage.test.tsx` pins it.
 * Searching is the one thing that removes entries, and only in answer to
 * something the reader typed.
 */

import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Sparkles from 'lucide-react/icons/sparkles';
import Globe from 'lucide-react/icons/globe';
import Shield from 'lucide-react/icons/shield';
import Info from 'lucide-react/icons/info';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import BookOpen from 'lucide-react/icons/book-open';
import Heart from 'lucide-react/icons/heart';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';
import { SearchField } from '@/components/ui/SearchField';
import featuresCatalogue from '@/data/featuresCatalogue.json';
import { useTenant } from '@/contexts';

export type Maturity = 'ga' | 'beta' | 'preview' | 'dormant';

interface FeatureItem {
  key: string;
  maturity?: Maturity;
}

interface FeatureGroup {
  key: string;
  items: FeatureItem[];
}

// 🔴 The catalogue is SHARED with the accessible frontend (web-uk), which
// renders the same entries on its own /features page. Group order, item order
// and each item's maturity live in the JSON. The TEXT does not: it stays in
// public.json under features_page.groups.*, so adding a feature means adding
// its title and description to all eleven locale files.
//
// web-uk cannot read this file at runtime (its Docker build context is
// web-uk/), so it keeps a generated copy, refreshed with
// `npm --prefix web-uk run build:features` and checked by
// `npm --prefix web-uk run check:features`.
const GROUPS: FeatureGroup[] = featuresCatalogue.groups as FeatureGroup[];

// Keyed by group, not positional: a positional `icons[index]` array silently
// reassigned every icon whenever a group was added or reordered.
const GROUP_ICONS: Record<string, ReactNode> = {
  core_platform: <Sparkles className="size-5 text-accent" aria-hidden="true" />,
  federation: <Globe className="size-5 text-accent" aria-hidden="true" />,
  member_experience: <Users className="size-5 text-success" aria-hidden="true" />,
  content_and_communication: <BookOpen className="size-5 text-success" aria-hidden="true" />,
  trust_reputation_and_safety: <Shield className="size-5 text-warning" aria-hidden="true" />,
  ai_and_recommendation_engine: <Sparkles className="size-5 text-accent" aria-hidden="true" />,
  caring_community_layer: <Heart className="size-5 text-accent" aria-hidden="true" />,
  built_for_production: <Shield className="size-5 text-accent" aria-hidden="true" />,
};

export function MaturityChip({ level }: { level: Maturity }) {
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

function FeatureList({ groupKey, items }: { groupKey: string; items: FeatureItem[] }) {
  const { t, i18n } = useTranslation('public');

  return (
    <ul data-feature-list className="list-none space-y-3">
      {items.map((item) => {
        const copyKey = `features_page.groups.${groupKey}.items.${item.key}`;
        const noteKey = `${copyKey}.note`;
        const note = i18n.exists(noteKey, { ns: 'public' }) ? t(noteKey) : '';

        return (
          <li key={item.key} className="flex items-start gap-2">
            <CheckCircle className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{t(`${copyKey}.title`)}</span>
              <MaturityChip level={item.maturity ?? 'ga'} />
              <span className="text-theme-muted"> {t(`${copyKey}.description`)}</span>
              {note && <p className="mt-1 text-xs italic text-theme-muted">{note}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Search across the rendered wording, not the key names: someone searching
 * "credits" should find "Attendance Rewards", whose key says nothing about
 * credits. Notes are included so "switched off" finds the dormant entries.
 */
function useFeatureSearch(groups: FeatureGroup[]) {
  const { t, i18n } = useTranslation('public');
  const [query, setQuery] = useState('');

  const haystack = useCallback(
    (groupKey: string, itemKey: string) => {
      const base = `features_page.groups.${groupKey}.items.${itemKey}`;
      const noteKey = `${base}.note`;
      const note = i18n.exists(noteKey, { ns: 'public' }) ? t(noteKey) : '';
      return `${t(`${base}.title`)} ${t(`${base}.description`)} ${note}`.toLowerCase();
    },
    [t, i18n]
  );

  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => haystack(group.key, item.key).includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, needle, haystack]);

  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const shown = visible.reduce((n, g) => n + g.items.length, 0);

  return { query, setQuery, visible, total, shown, isSearching: needle !== '' };
}

export function FeatureCatalogue() {
  const { t, i18n } = useTranslation('public');
  const { branding } = useTenant();
  const { query, setQuery, visible, total, shown, isSearching } = useFeatureSearch(GROUPS);
  // The groups a reader has opened by hand.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // While someone is searching, every group that still has an entry is open:
  // the answer is what they asked to see. They may close one to get it out of
  // the way; that is remembered only until the search changes, and it never
  // touches `open`, so clearing the search gives back exactly what was open
  // before it.
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(() => new Set());

  const changeQuery = (value: string) => {
    setQuery(value);
    setClosedInSearch(new Set());
  };

  const withKey = (keys: ReadonlySet<string>, key: string, present: boolean) => {
    const next = new Set(keys);
    if (present) next.add(key);
    else next.delete(key);
    return next;
  };

  const toggle = (key: string, isExpanded: boolean) => {
    if (isSearching) setClosedInSearch((current) => withKey(current, key, !isExpanded));
    else setOpen((current) => withKey(current, key, isExpanded));
  };

  return (
    <section aria-labelledby="features-catalogue-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="features-catalogue-heading" className="text-xl font-semibold text-foreground">
          {t('features_page.welcome.catalogue_heading')}
        </h2>
        <p className="text-sm text-theme-muted" aria-live="polite">
          {isSearching
            ? t('features_page.welcome.search_results', { shown, total })
            : t('features_page.welcome.catalogue_count', { total, groups: GROUPS.length })}
        </p>
      </div>

      {/* The availability note. One line, directly above the list it is about —
          see the note at the top of this file before moving or removing it. */}
      <Alert
        color="accent"
        role="note"
        data-availability-note
        className="border border-accent bg-accent/10"
        icon={<Info className="size-5" aria-hidden="true" />}
        description={
          <span className="text-foreground">
            {t('features_page.welcome.catalogue_note', { name: branding.name })}
          </span>
        }
      />

      <SearchField
        value={query}
        onValueChange={changeQuery}
        onClear={() => changeQuery('')}
        isClearable
        aria-label={t('features_page.search_label')}
        placeholder={t('features_page.search_placeholder')}
        startContent={<Search size={16} className="text-theme-muted" aria-hidden="true" />}
      />

      {visible.length > 0 ? (
        <Card className="border border-border shadow-sm">
          <Card.Content className="divide-y divide-border p-0">
            {visible.map((group) => {
              const groupKey = `features_page.groups.${group.key}`;
              const introKey = `${groupKey}.intro`;
              const intro = i18n.exists(introKey, { ns: 'public' }) ? t(introKey) : '';

              return (
                <div key={group.key} data-feature-group={group.key}>
                  <Disclosure
                    isExpanded={isSearching ? !closedInSearch.has(group.key) : open.has(group.key)}
                    onExpandedChange={(isExpanded) => toggle(group.key, isExpanded)}
                  >
                    <DisclosureHeading>
                      <DisclosureTrigger className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start sm:px-5">
                        {GROUP_ICONS[group.key]}
                        <span className="min-w-0 flex-1 text-base font-semibold text-foreground">
                          {t(`${groupKey}.title`)}
                        </span>
                        <Chip variant="tertiary" size="sm" className="shrink-0">
                          {group.items.length}
                        </Chip>
                        <DisclosureIndicator className="shrink-0 text-theme-muted" />
                      </DisclosureTrigger>
                    </DisclosureHeading>
                    <DisclosureContent>
                      <DisclosureBody className="space-y-3 px-4 pb-5 sm:px-5">
                        {intro && <p className="text-sm text-theme-muted">{intro}</p>}
                        <FeatureList groupKey={group.key} items={group.items} />
                      </DisclosureBody>
                    </DisclosureContent>
                  </Disclosure>
                </div>
              );
            })}
          </Card.Content>
        </Card>
      ) : (
        <Card data-no-results className="border border-border shadow-sm">
          <Card.Content className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="font-semibold text-foreground">{t('features_page.no_results_title')}</p>
            <p className="text-sm text-theme-muted">{t('features_page.welcome.no_results_body')}</p>
            <Button variant="secondary" className="mt-2" onPress={() => changeQuery('')}>
              {t('features_page.welcome.clear_search')}
            </Button>
          </Card.Content>
        </Card>
      )}
    </section>
  );
}

export default FeatureCatalogue;
