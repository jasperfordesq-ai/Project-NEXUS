// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * About page — the community's own page (owner, 14 Nov 2026).
 *
 * Until then the page was the same for every community with only the name
 * swapped in, and a quarter of it was credits for the software. Top to bottom
 * it is now:
 *
 * 1. The warm banner every other page opens with, carrying the community's
 *    OWN words: Admin → Community settings → "Short description"
 *    (`tenant.description`). A community that has written nothing gets one
 *    standard sentence.
 * 2. The community's real numbers, from `/v2/platform/stats`. A figure that is
 *    zero is left out, so a new community is not shown an empty scoreboard.
 * 3. One example exchange, told as a three-step story.
 * 4. What matters to us.
 * 5. Get in touch: whatever contact details the community has filled in.
 * 6. One small panel of credits for the software.
 *
 * 🔴 The credits panel is attribution, not decoration. Every name still comes
 * from `contributors.json` and the licence and source-code link stay (root
 * AGENTS.md, "OPEN SOURCE — AGPL-3.0"). It may be small; it may not be removed
 * or hidden behind a control.
 *
 * 🔴 The community photo is NOT shown here. The owner's rule (13 Nov 2026) is
 * that it appears on the home page only.
 *
 * Nothing on the page waits for an animation to become visible: the old page
 * faded each section in as it scrolled into view, which left sections blank
 * for anything that reads the page without scrolling it.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Wrench from 'lucide-react/icons/wrench';
import Coins from 'lucide-react/icons/coins';
import Flower2 from 'lucide-react/icons/flower-2';
import Scale from 'lucide-react/icons/scale';
import House from 'lucide-react/icons/house';
import HandHeart from 'lucide-react/icons/hand-heart';
import Recycle from 'lucide-react/icons/recycle';
import Mail from 'lucide-react/icons/mail';
import Phone from 'lucide-react/icons/phone';
import MapPin from 'lucide-react/icons/map-pin';
import HelpCircle from 'lucide-react/icons/circle-help';
import ArrowRight from 'lucide-react/icons/arrow-right';
import BookOpen from 'lucide-react/icons/book-open';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useAuth } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { categoryColour } from '@/lib/categoryColours';
import { logError } from '@/lib/logger';
import contributors from '@/data/contributors.json';
import { PROJECT_NEXUS_REPO_URL } from '@/config/externalLinks';

/* ─────────────── Types ─────────────── */

interface PlatformStats {
  members: number;
  hours_exchanged: number;
  listings: number;
  skills: number;
  communities: number;
}

/* ─────────────── Data ─────────────── */

const ICON = 'size-6';

/** Wording lives at `about.how_it_works.steps.<index>`. */
const STEP_ICONS: readonly ReactNode[] = [
  <Wrench key="give" className={ICON} aria-hidden="true" />,
  <Coins key="earn" className={ICON} aria-hidden="true" />,
  <Flower2 key="spend" className={ICON} aria-hidden="true" />,
];

/** Wording lives at `about.values.items.<index>`. */
const VALUE_ICONS: readonly ReactNode[] = [
  <Scale key="equal" className="size-5" aria-hidden="true" />,
  <House key="neighbours" className="size-5" aria-hidden="true" />,
  <HandHeart key="care" className="size-5" aria-hidden="true" />,
  <Recycle key="share" className="size-5" aria-hidden="true" />,
];

const SECTION_HEADING = 'text-xl font-semibold text-foreground';
const CREDIT_HEADING = 'text-sm font-semibold text-foreground';
const CREDIT_LIST = 'mt-1.5 space-y-1 text-sm text-theme-muted';

/* ─────────────── Helpers ─────────────── */

function formatStatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString(getFormattingLocale());
}

/** A phone number as a `tel:` address: digits and a leading plus only. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/* ─────────────── Component ─────────────── */

export function AboutPage() {
  const { t } = useTranslation('public');
  const { tenant, branding, tenantPath } = useTenant();
  usePageTitle(t('about.meta_title', { name: branding?.name || 'About' }));
  const { isAuthenticated, isLoading } = useAuth();
  const palette = useSitePalette();
  const [stats, setStats] = useState<PlatformStats | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  const loadStats = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get<PlatformStats>('/v2/platform/stats');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load platform stats on about page', err);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Only for someone we know is signed out. While the sign-in check is still
  // running a member reloading the page would otherwise be asked to join.
  const invitesToJoin = !isAuthenticated && !isLoading;

  // The community's own words; the standard sentence when it has written none.
  const ownWords = typeof tenant?.description === 'string' ? tenant.description.trim() : '';
  const opening = ownWords || t('about.hero_description', { name: branding.name });

  // A figure that is zero says nothing kind about a young community: leave it out.
  const figures = stats
    ? [
        { key: 'members', value: stats.members, label: t('about.stats.members') },
        { key: 'hours', value: stats.hours_exchanged, label: t('about.stats.hours_exchanged') },
        { key: 'listings', value: stats.listings, label: t('about.stats.active_listings') },
        // A hub's own count of communities; a single community has no use for "1".
        { key: 'communities', value: stats.communities > 1 ? stats.communities : 0, label: t('about.stats.communities') },
      ].filter((figure) => Number.isFinite(figure.value) && figure.value > 0)
    : [];

  const contact = tenant?.contact;
  const place = contact?.address || contact?.location;
  const hasContactDetails = Boolean(contact?.email || contact?.phone || place);

  const creators = contributors.filter((c) => c.type === 'creator');
  const founders = contributors.filter((c) => c.type === 'creator' || c.type === 'founder');
  const helpers = contributors.filter((c) => c.type === 'contributor');
  const acknowledged = contributors.filter((c) => c.type === 'acknowledgement');
  const researchBody = contributors.find((c) => c.note?.includes('social impact study'));

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('about.meta_title', { name: branding.name })}
        description={t('about.meta_description', { name: branding.name })}
      />

      {/* ─── The community, in its own words ─── */}
      <PublicPageHero
        title={t('about.hero_title', { name: branding.name })}
        description={opening}
        icon={<HeartHandshake className="h-7 w-7" aria-hidden="true" />}
        action={
          invitesToJoin ? (
            <Button as={Link} to={tenantPath('/register')} variant="primary" size="lg">
              {t('about.cta.join')}
            </Button>
          ) : undefined
        }
      />

      {/* ─── The community's real numbers ─── */}
      {figures.length > 0 && (
        <dl
          data-testid="about-figures"
          className={`grid gap-3 ${figures.length > 3 ? 'grid-cols-2 lg:grid-cols-4' : figures.length === 3 ? 'sm:grid-cols-3' : figures.length === 2 ? 'grid-cols-2' : ''}`}
        >
          {figures.map((figure) => (
            // The label comes first for a screen reader ("members: 31") and
            // second to the eye (the big number, then what it counts).
            <div key={figure.key} className="flex flex-col-reverse rounded-2xl bg-accent-soft px-5 py-4 text-center">
              <dt className="mt-1 text-sm leading-6 text-theme-secondary">{figure.label}</dt>
              <dd className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {formatStatNumber(figure.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* ─── One exchange, start to finish ─── */}
      <section aria-labelledby="about-how-heading" className="space-y-4">
        <div>
          <h2 id="about-how-heading" className={SECTION_HEADING}>
            {t('about.how_it_works.title')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('about.how_it_works.subtitle')}</p>
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
                        {t(`about.how_it_works.steps.${index}.title`)}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-theme-muted">
                        {t(`about.how_it_works.steps.${index}.description`)}
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
      </section>

      {/* ─── What matters to us ─── */}
      <section aria-labelledby="about-values-heading" className="space-y-4">
        <div>
          <h2 id="about-values-heading" className={SECTION_HEADING}>
            {t('about.values.title')}
          </h2>
          <p className="mt-1 text-theme-muted">{t('about.values.subtitle', { name: branding.name })}</p>
        </div>
        <ul className="grid list-none gap-4 sm:grid-cols-2">
          {VALUE_ICONS.map((icon, index) => (
            // A fixed list that never reorders.
            <li key={index} className="flex items-start gap-3 rounded-2xl bg-accent-soft p-4">
              <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{t(`about.values.items.${index}.title`)}</h3>
                <p className="mt-0.5 text-sm leading-6 text-theme-secondary">
                  {t(`about.values.items.${index}.description`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Get in touch ─── */}
      <section aria-labelledby="about-contact-heading">
        <Card className="border border-border shadow-sm">
          <Card.Content className="flex flex-col gap-6 p-1 sm:p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 id="about-contact-heading" className={SECTION_HEADING}>
                {t('about.cta.title')}
              </h2>
              <p className="mt-1 max-w-xl text-theme-muted">{t('about.cta.description')}</p>
              {hasContactDetails && (
                <ul data-testid="about-contact-details" className="mt-4 list-none space-y-2 text-sm">
                  {contact?.email && (
                    <li className="flex items-center gap-2.5">
                      <Mail className="size-4 shrink-0 text-accent" aria-hidden="true" />
                      <a
                        href={`mailto:${contact.email}`}
                        className="break-all font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2"
                      >
                        {contact.email}
                      </a>
                    </li>
                  )}
                  {contact?.phone && (
                    <li className="flex items-center gap-2.5">
                      <Phone className="size-4 shrink-0 text-accent" aria-hidden="true" />
                      <a
                        href={telHref(contact.phone)}
                        dir="ltr"
                        className="font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2"
                      >
                        {contact.phone}
                      </a>
                    </li>
                  )}
                  {place && (
                    <li className="flex items-start gap-2.5">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      <span className="whitespace-pre-line text-theme-secondary">{place}</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:shrink-0 lg:justify-end">
              {isAuthenticated ? (
                <Button
                  as={Link}
                  to={tenantPath('/dashboard')}
                  variant="primary"
                  endContent={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
                >
                  {t('about.cta.dashboard')}
                </Button>
              ) : (
                invitesToJoin && (
                  <Button
                    as={Link}
                    to={tenantPath('/register')}
                    variant="primary"
                    endContent={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
                  >
                    {t('about.cta.join')}
                  </Button>
                )
              )}
              <Button
                as={Link}
                to={tenantPath('/contact')}
                variant="secondary"
                startContent={<Mail className="size-4" aria-hidden="true" />}
              >
                {t('about.cta.contact_us')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/help')}
                variant="secondary"
                startContent={<HelpCircle className="size-4" aria-hidden="true" />}
              >
                {t('about.cta.help_center')}
              </Button>
            </div>
          </Card.Content>
        </Card>
      </section>

      {/* ─── About the software (attribution — see the note at the top) ─── */}
      <section
        aria-labelledby="about-software-heading"
        data-testid="about-software"
        className="rounded-2xl border border-border p-5 sm:p-6"
      >
        <h2 id="about-software-heading" className="text-base font-semibold text-foreground">
          {t('about.credits.title')}
        </h2>
        <p className="mt-1 text-sm text-theme-muted">{t('about.credits.subtitle')}</p>

        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className={CREDIT_HEADING}>{t('about.credits.creator')}</h3>
            <ul className={CREDIT_LIST}>
              {creators.map((c) => (
                <li key={c.name}>{c.name}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={CREDIT_HEADING}>{t('about.credits.founders_heading')}</h3>
            <ul className={CREDIT_LIST}>
              {founders.map((c) => (
                <li key={c.name}>{c.name}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={CREDIT_HEADING}>{t('about.credits.contributors')}</h3>
            <ul className={CREDIT_LIST}>
              {helpers.map((c) => (
                <li key={c.name}>
                  <span className="font-medium text-foreground">{c.name}</span> — {c.role}
                </li>
              ))}
            </ul>
          </div>

          {researchBody && (
            <div>
              <h3 className={CREDIT_HEADING}>{t('about.credits.research_heading')}</h3>
              <p className="mt-1.5 text-sm text-theme-muted">
                {t('about.credits.research_description', { name: researchBody.name })}
              </p>
            </div>
          )}

          <div>
            <h3 className={CREDIT_HEADING}>{t('about.credits.acknowledgements')}</h3>
            <ul className={CREDIT_LIST}>
              {acknowledged.map((c) => (
                <li key={c.name}>
                  {c.name}
                  {c.role !== 'Research Foundation' ? `, ${c.role}` : ''}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={CREDIT_HEADING}>{t('about.credits.open_source')}</h3>
            <p className="mt-1.5 text-sm text-theme-muted">{t('about.credits.license_text')}</p>
            <a
              href={PROJECT_NEXUS_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2"
            >
              <BookOpen className="size-4 shrink-0 text-accent" aria-hidden="true" />
              {t('about.credits.source_code')}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
