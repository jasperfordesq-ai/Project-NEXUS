// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Timebanking Guide — what timebanking is, where it came from and what it
 * stands for (owner, 14 Nov 2026). Shown by every community, so nothing on it
 * is about one community except where it says so.
 *
 * Top to bottom:
 *
 * 1. The warm banner every other page opens with.
 * 2. How it works: give an hour, earn a time credit, spend it. Then the one
 *    rule that makes it timebanking — everyone's hour is worth the same.
 * 3. What people share: everyday examples.
 * 4. Where timebanking comes from: Edgar Cahn, and how the idea grew.
 * 5. The five values every timebank shares (Cahn's core values).
 * 6. What the research found.
 * 7. Good to know: four short questions.
 * 8. Related pages, then a closing invitation.
 *
 * 🔴 The history is checked fact, not colour. The dates and names in section 4
 * were looked up on 14 Nov 2026: Cahn's life, his 1980 heart attack and his
 * death in 2022 in the University of the District of Columbia law school's
 * and the American Bar Association Journal's obituaries; TimeBanks USA (1995)
 * and "Time Dollars" (1992, with Jonathan Rowe) in his encyclopedia entry;
 * the first edition of "No More Throw-Away People" (2000) in Open Library;
 * Teruko Mizushima's Volunteer Labour Bank (1973) in Jill Miller's paper held
 * by the Australian National University. Do not add a date, a quotation or a
 * "first" that has not been checked the same way — sources disagree, for
 * example, on whether Mizushima's was the world's first timebank, so the page
 * does not say it was. The values in section 5 are Cahn's five, told in the
 * platform's own words: they are not quotations and must not be dressed up
 * as any.
 *
 * 🔴 The figures in section 6 are ONE timebank's: the 2023 independent study
 * of hOUR Timebank in Ireland. Until 14 Nov 2026 every community's page showed
 * them under "Proven Impact" as if they were true of timebanking everywhere.
 * The section must keep saying whose results they are. The link to the full
 * summary is offered only where that page exists (hour-timebank).
 *
 * Nothing on the page waits for an animation to become visible: the old page
 * faded each section in as it scrolled into view, which left sections blank
 * for anything that reads the page without scrolling it.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BookOpen from 'lucide-react/icons/book-open';
import HandHelping from 'lucide-react/icons/hand-helping';
import Coins from 'lucide-react/icons/coins';
import Flower2 from 'lucide-react/icons/flower-2';
import Scale from 'lucide-react/icons/scale';
import Car from 'lucide-react/icons/car';
import Smartphone from 'lucide-react/icons/smartphone';
import Coffee from 'lucide-react/icons/coffee';
import Sprout from 'lucide-react/icons/sprout';
import Hammer from 'lucide-react/icons/hammer';
import CookingPot from 'lucide-react/icons/cooking-pot';
import Languages from 'lucide-react/icons/languages';
import Music from 'lucide-react/icons/music';
import Gem from 'lucide-react/icons/gem';
import HandHeart from 'lucide-react/icons/hand-heart';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Users from 'lucide-react/icons/users';
import Handshake from 'lucide-react/icons/handshake';
import Lightbulb from 'lucide-react/icons/lightbulb';
import HelpCircle from 'lucide-react/icons/circle-help';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useAuth } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { usePageTitle } from '@/hooks';
import { categoryColour } from '@/lib/categoryColours';
import { RelatedPages } from './RelatedPages';

/* ─────────────── Data ─────────────── */

const ICON = 'size-6';
const SMALL_ICON = 'size-5';

/** Wording lives at `timebanking_guide.step_<index>_title` / `_description`. */
const STEP_ICONS: readonly ReactNode[] = [
  <HandHelping key="give" className={ICON} aria-hidden="true" />,
  <Coins key="earn" className={ICON} aria-hidden="true" />,
  <Flower2 key="spend" className={ICON} aria-hidden="true" />,
];

/** Wording lives at `timebanking_guide.share_<index>`. */
const SHARE_ICONS: readonly ReactNode[] = [
  <Car key="lift" className="size-4" aria-hidden="true" />,
  <Smartphone key="form" className="size-4" aria-hidden="true" />,
  <Coffee key="chat" className="size-4" aria-hidden="true" />,
  <Sprout key="garden" className="size-4" aria-hidden="true" />,
  <Hammer key="jobs" className="size-4" aria-hidden="true" />,
  <CookingPot key="cooking" className="size-4" aria-hidden="true" />,
  <Languages key="language" className="size-4" aria-hidden="true" />,
  <Music key="music" className="size-4" aria-hidden="true" />,
];

/**
 * How the idea grew. A year is a number, so it is not wording; the last entry
 * has no year and is labelled "Today". Wording lives at
 * `timebanking_guide.timeline_<index>`. See the note at the top before
 * changing a year.
 */
const TIMELINE_YEARS: readonly (string | null)[] = ['1973', '1980', '1992', '1995', '2000', null];

/** Edgar Cahn's five core values. Wording lives at `timebanking_guide.value_<index>_*`. */
const VALUE_ICONS: readonly ReactNode[] = [
  <Gem key="assets" className={SMALL_ICON} aria-hidden="true" />,
  <HandHeart key="work" className={SMALL_ICON} aria-hidden="true" />,
  <ArrowLeftRight key="reciprocity" className={SMALL_ICON} aria-hidden="true" />,
  <Users key="networks" className={SMALL_ICON} aria-hidden="true" />,
  <Handshake key="respect" className={SMALL_ICON} aria-hidden="true" />,
];

/**
 * hOUR Timebank's 2023 independent study (see the note at the top). The key is
 * the old figure's name, kept so the wording keys did not have to move.
 */
const STUDY_FIGURES: readonly { key: string; value: string }[] = [
  { key: '161', value: '€16' },
  { key: '100', value: '100%' },
  { key: '95', value: '95%' },
];

const QUESTION_COUNT = 4;

/** A person's name and the years he lived: neither is wording to translate. */
const FOUNDER_NAME = 'Edgar S. Cahn';
const FOUNDER_YEARS = '1935–2022';

const SECTION_HEADING = 'text-xl font-semibold text-foreground';
const TEXT_LINK =
  'font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2';

/* ─────────────── Component ─────────────── */

export function TimebankingGuidePage() {
  const { t } = useTranslation('about');
  usePageTitle(t('timebanking_guide.page_title'));
  const { tenant, tenantPath, hasModule, branding } = useTenant();
  const { isAuthenticated, isLoading } = useAuth();
  const palette = useSitePalette();

  // `/partner` and `/impact-summary` only exist for hour-timebank: both route
  // files wrap them in TenantSlugGate slug="hour-timebank", which checks
  // `tenant.slug`. Offering either anywhere else sends people to a page that
  // bounces them.
  const isHourTimebank = tenant?.slug === 'hour-timebank';

  // Only for someone we know is signed out. While the sign-in check is still
  // running a member reloading the page would otherwise be asked to join.
  const invitesToJoin = !isAuthenticated && !isLoading;
  const browsesOffers = isAuthenticated && hasModule('listings');

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('timebanking_guide.page_title')}
        description={t('timebanking_guide.meta_description', { name: branding.name })}
      />

      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: t('timebanking_guide.breadcrumb_about'), href: '/about' },
            { label: t('timebanking_guide.page_title') },
          ]}
        />

        <PublicPageHero
          title={t('timebanking_guide.page_title')}
          description={t('timebanking_guide.hero_subtitle')}
          icon={<BookOpen className="h-7 w-7" aria-hidden="true" />}
          action={
            invitesToJoin ? (
              <Button as={Link} to={tenantPath('/register')} variant="primary" size="lg">
                {t('timebanking_guide.cta_join')}
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* ─── How it works ─── */}
      <section aria-labelledby="guide-how-heading" className="space-y-4">
        <div>
          <h2 id="guide-how-heading" className={SECTION_HEADING}>
            {t('timebanking_guide.how_it_works_heading')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('timebanking_guide.how_it_works_subtitle')}</p>
        </div>
        <ol className="grid list-none gap-4 md:grid-cols-3">
          {STEP_ICONS.map((icon, index) => {
            // The community's own colours, one per step, in a fixed order.
            const tint = categoryColour(palette[index % palette.length]).band;
            const isLast = index === STEP_ICONS.length - 1;
            return (
              // A fixed list that never reorders: the index IS the step.
              <li key={index} className="relative">
                <Card className="h-full border border-border shadow-sm">
                  <Card.Content className="flex flex-col gap-3 p-0 sm:p-1">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex shrink-0 rounded-2xl p-3 ${tint}`}>{icon}</span>
                      <span
                        aria-hidden="true"
                        className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-foreground"
                      >
                        {index + 1}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {t(`timebanking_guide.step_${index}_title`)}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-theme-muted">
                        {t(`timebanking_guide.step_${index}_description`)}
                      </p>
                    </div>
                  </Card.Content>
                </Card>
                {!isLast && (
                  // The arrow sits in the gap to the next step: beside it on a
                  // wide screen, underneath it on a phone.
                  <span
                    aria-hidden="true"
                    className="absolute z-10 flex size-8 items-center justify-center rounded-full border border-theme-default bg-theme-elevated text-accent shadow-sm max-md:-bottom-6 max-md:start-1/2 max-md:-translate-x-1/2 max-md:rtl:translate-x-1/2 md:-end-6 md:top-1/2 md:-translate-y-1/2"
                  >
                    <ArrowRight className="size-4 max-md:rotate-90 md:rtl:rotate-180" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {/* The one rule that makes it timebanking. */}
        <div className="flex items-start gap-3 rounded-2xl bg-accent-soft p-4 sm:p-5">
          <Scale className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{t('timebanking_guide.equal_title')}</h3>
            <p className="mt-1 text-sm leading-6 text-theme-secondary">{t('timebanking_guide.equal_text')}</p>
          </div>
        </div>
      </section>

      {/* ─── What people share ─── */}
      <section aria-labelledby="guide-share-heading" className="space-y-4">
        <div>
          <h2 id="guide-share-heading" className={SECTION_HEADING}>
            {t('timebanking_guide.share_heading')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('timebanking_guide.share_subtitle')}</p>
        </div>
        <ul data-testid="guide-examples" className="flex list-none flex-wrap gap-2.5">
          {SHARE_ICONS.map((icon, index) => (
            // A fixed list that never reorders.
            <li
              key={index}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium ${categoryColour(palette[index % palette.length]).band}`}
            >
              {icon}
              {t(`timebanking_guide.share_${index}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Where timebanking comes from (checked fact — see the note at the top) ─── */}
      <section aria-labelledby="guide-origins-heading" data-testid="guide-origins" className="space-y-4">
        <div>
          <h2 id="guide-origins-heading" className={SECTION_HEADING}>
            {t('timebanking_guide.origins_heading')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('timebanking_guide.origins_subtitle')}</p>
        </div>
        <Card className="border border-border shadow-sm">
          <Card.Content className="grid gap-8 p-1 sm:p-3 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex shrink-0 rounded-2xl bg-accent-soft p-3 text-accent">
                  <Lightbulb className={ICON} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-foreground">
                    {FOUNDER_NAME}{' '}
                    <span className="whitespace-nowrap text-sm font-normal text-theme-muted">{FOUNDER_YEARS}</span>
                  </h3>
                  <p className="text-sm text-theme-muted">{t('timebanking_guide.origins_role')}</p>
                </div>
              </div>
              <p className="leading-7 text-theme-secondary">{t('timebanking_guide.origins_para_0')}</p>
              <p className="leading-7 text-theme-secondary">{t('timebanking_guide.origins_para_1')}</p>
              <p className="leading-7 text-theme-secondary">{t('timebanking_guide.origins_para_2')}</p>
              <p className="border-s-2 border-accent ps-4 text-sm leading-6 text-theme-muted">
                {t('timebanking_guide.origins_para_3')}
              </p>
            </div>

            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">{t('timebanking_guide.timeline_heading')}</h3>
              <ol className="mt-4 list-none space-y-4 border-s-2 border-accent-soft ps-5">
                {TIMELINE_YEARS.map((year, index) => (
                  // A fixed list that never reorders.
                  <li key={index} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full bg-accent"
                    />
                    <p className="text-sm font-semibold text-foreground">
                      {year ?? t('timebanking_guide.timeline_today')}
                    </p>
                    <p className="text-sm leading-6 text-theme-muted">
                      {t(`timebanking_guide.timeline_${index}`, { name: branding.name })}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </Card.Content>
        </Card>
      </section>

      {/* ─── The five values (Edgar Cahn's core values, in our own words) ─── */}
      <section aria-labelledby="guide-values-heading" className="space-y-4">
        <div>
          <h2 id="guide-values-heading" className={SECTION_HEADING}>
            {t('timebanking_guide.values_heading')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('timebanking_guide.values_subtitle')}</p>
        </div>
        {/* Three across then two across on a wide screen, so five fill the grid. */}
        <ol data-testid="guide-values" className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {VALUE_ICONS.map((icon, index) => (
            // A fixed list that never reorders.
            <li
              key={index}
              className={`flex items-start gap-3 rounded-2xl bg-accent-soft p-4 ${index < 3 ? 'lg:col-span-2' : 'lg:col-span-3'} ${index === VALUE_ICONS.length - 1 ? 'sm:max-lg:col-span-2' : ''}`}
            >
              <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  {t(`timebanking_guide.value_${index}_title`)}
                </h3>
                <p className="mt-0.5 text-sm leading-6 text-theme-secondary">
                  {t(`timebanking_guide.value_${index}_description`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── What the research found (one timebank's results — see the note at the top) ─── */}
      <section aria-labelledby="guide-evidence-heading" data-testid="guide-evidence" className="space-y-4">
        <div>
          <h2 id="guide-evidence-heading" className={SECTION_HEADING}>
            {t('timebanking_guide.evidence_heading')}
          </h2>
          <p className="mt-1 max-w-3xl text-theme-muted">{t('timebanking_guide.evidence_subtitle')}</p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {STUDY_FIGURES.map((figure) => (
            // The label comes first for a screen reader and second to the eye
            // (the big figure, then what it measures).
            <div key={figure.key} className="flex flex-col-reverse rounded-2xl bg-accent-soft px-5 py-4 text-center">
              <dt className="mt-1 text-sm leading-6 text-theme-secondary">
                {t(`timebanking_guide.stat_${figure.key}_label`)}
              </dt>
              <dd className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{figure.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-theme-muted">
          {t('timebanking_guide.evidence_note')}
          {isHourTimebank && (
            <>
              {' '}
              <Link to={tenantPath('/impact-summary')} className={TEXT_LINK}>
                {t('timebanking_guide.evidence_link')}
              </Link>
            </>
          )}
        </p>
      </section>

      {/* ─── Good to know ─── */}
      <section aria-labelledby="guide-questions-heading" className="space-y-4">
        <h2 id="guide-questions-heading" className={`flex items-center gap-2 ${SECTION_HEADING}`}>
          <HelpCircle className="size-5 shrink-0 text-accent" aria-hidden="true" />
          {t('timebanking_guide.faq_heading')}
        </h2>
        <Accordion variant="splitted" selectionMode="multiple" data-testid="guide-questions">
          {Array.from({ length: QUESTION_COUNT }, (_, index) => {
            const question = t(`timebanking_guide.faq_${index}_q`);
            return (
              <AccordionItem key={index} id={`question-${index}`} aria-label={question} title={question}>
                <p className="text-sm leading-relaxed text-theme-secondary">
                  {t(`timebanking_guide.faq_${index}_a`)}
                </p>
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>

      {/* ─── Related pages (only hour-timebank has any) ─── */}
      <RelatedPages current="/timebanking-guide" flush />

      {/* ─── A closing invitation ─── */}
      <section aria-labelledby="guide-cta-heading">
        <Card className="border border-border shadow-sm">
          <Card.Content className="flex flex-col gap-6 p-1 sm:p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 id="guide-cta-heading" className={SECTION_HEADING}>
                {t('timebanking_guide.cta_heading')}
              </h2>
              <p className="mt-1 max-w-xl text-theme-muted">{t('timebanking_guide.cta_subtitle')}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:shrink-0 lg:justify-end">
              {browsesOffers && (
                <Button
                  as={Link}
                  to={tenantPath('/listings')}
                  variant="primary"
                  endContent={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
                >
                  {t('timebanking_guide.cta_browse_listings')}
                </Button>
              )}
              {invitesToJoin && (
                <Button
                  as={Link}
                  to={tenantPath('/register')}
                  variant="primary"
                  endContent={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
                >
                  {t('timebanking_guide.cta_join')}
                </Button>
              )}
              {isHourTimebank && (
                <Button
                  as={Link}
                  to={tenantPath('/partner')}
                  variant="secondary"
                  startContent={<Handshake className="size-4" aria-hidden="true" />}
                >
                  {t('timebanking_guide.cta_partner')}
                </Button>
              )}
              <Button
                as={Link}
                to={tenantPath('/help')}
                variant="secondary"
                startContent={<HelpCircle className="size-4" aria-hidden="true" />}
              >
                {t('timebanking_guide.cta_help')}
              </Button>
            </div>
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

export default TimebankingGuidePage;
