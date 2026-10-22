// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * LandingPageRenderer
 *
 * Reads the tenant's landing page configuration and renders the enabled
 * sections in the configured order. Falls back to defaults when no
 * custom config is provided.
 *
 * Wraps all sections in <MotionConfig reducedMotion="user"> so that
 * Framer Motion automatically respects the user's prefers-reduced-motion
 * system preference — all animations become instant when set.
 */

import { useMemo } from 'react';
import { MotionConfig } from '@/lib/motion';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { FeatureErrorBoundary } from '@/components/feedback/FeatureErrorBoundary';
import { DEFAULT_LANDING_PAGE_CONFIG } from '@/types';
import type {
  LandingSection,
  HeroContent,
  AudienceCardsContent,
  FeaturePillsContent,
  StatsContent,
  HowItWorksContent,
  CoreValuesContent,
  CtaContent,
} from '@/types';
import { HeroSection } from './HeroSection';
import { AudienceCardsSection } from './AudienceCardsSection';
import { FeaturePillsSection } from './FeaturePillsSection';
import { StatsSection } from './StatsSection';
import { HowItWorksSection } from './HowItWorksSection';
import { CoreValuesSection } from './CoreValuesSection';
import { CtaSection } from './CtaSection';

/**
 * Renders a single landing section based on its type and content.
 */
function RenderSection({ section }: { section: LandingSection }) {
  switch (section.type) {
    case 'hero':
      return <HeroSection content={section.content as HeroContent | undefined} />;
    case 'audience_cards':
      return <AudienceCardsSection content={section.content as AudienceCardsContent | undefined} />;
    case 'feature_pills':
      return <FeaturePillsSection content={section.content as FeaturePillsContent | undefined} />;
    case 'stats':
      return <StatsSection content={section.content as StatsContent | undefined} />;
    case 'how_it_works':
      return <HowItWorksSection content={section.content as HowItWorksContent | undefined} />;
    case 'core_values':
      return <CoreValuesSection content={section.content as CoreValuesContent | undefined} />;
    case 'cta':
      return <CtaSection content={section.content as CtaContent | undefined} />;
    default:
      if (import.meta.env.DEV) {
        console.warn(`[LandingPageRenderer] Unknown section type: "${(section as { type: string }).type}"`);
      }
      return null;
  }
}

function PublicDiscoveryLinks() {
  const { t } = useTranslation('common');
  const { hasFeature, hasModule, tenantPath } = useTenant();

  const links = [
    hasModule('listings') ? {
      href: tenantPath('/listings'),
      label: t('nav.listings'),
      description: t('nav_desc.timebanking_listings'),
    } : null,
    hasFeature('events') ? {
      href: tenantPath('/events'),
      label: t('nav.events'),
      description: t('nav_desc.events'),
    } : null,
    hasFeature('groups') ? {
      href: tenantPath('/groups'),
      label: t('nav.groups'),
      description: t('nav_desc.groups'),
    } : null,
    hasFeature('blog') ? {
      href: tenantPath('/blog'),
      label: t('nav.blog'),
      description: t('nav_desc.blog'),
    } : null,
  ].filter(Boolean);

  if (links.length === 0) return null;

  return (
    <nav
      aria-label={t('landing_links.aria_label')}
      className="border-t border-theme-default bg-theme-surface"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
        <h2 className="text-sm font-semibold uppercase text-theme-muted">
          {t('landing_links.title')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((link) => link && (
            <li key={link.href}>
              <Link
                to={link.href}
                className="block rounded-lg border border-theme-default bg-theme-elevated px-4 py-3 transition-colors hover:border-theme-accent hover:bg-theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]"
              >
                <span className="block text-sm font-semibold text-theme-primary">{link.label}</span>
                <span className="mt-1 block text-xs text-theme-muted">{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Fault tolerance for community-written landing pages (2026-10-22).
 *
 * Every community edits its landing page in the builder, so the renderer must
 * survive whatever is stored, not only what the builder writes today:
 *  - a config without a `sections` list falls back to the default page;
 *  - entries that are not objects, or have no type, are skipped;
 *  - each section renders inside its own error boundary, so one malformed
 *    section disappears (and is reported) instead of taking the page down;
 *  - when the hero is switched off there is still exactly one main heading
 *    (visually hidden, the community's name), which screen readers, search
 *    engines and the deploy gate's home-page check all rely on.
 */
function usableSections(config: unknown): LandingSection[] {
  const raw = (config as { sections?: unknown } | null | undefined)?.sections;
  const list = Array.isArray(raw) ? raw : DEFAULT_LANDING_PAGE_CONFIG.sections;
  return list.filter(
    (s): s is LandingSection =>
      !!s && typeof s === 'object' && typeof (s as { type?: unknown }).type === 'string',
  );
}

export function LandingPageRenderer() {
  const { landingPageConfig, branding } = useTenant();
  const { t } = useTranslation('public');

  const sortedSections = useMemo(() => {
    return usableSections(landingPageConfig)
      .filter((s) => s.enabled)
      .map((s, index) => ({ section: s, order: Number.isFinite(s.order) ? s.order : index }))
      .sort((a, b) => a.order - b.order)
      .map(({ section }) => section);
  }, [landingPageConfig]);

  const hasHero = sortedSections.some((s) => s.type === 'hero');

  return (
    <MotionConfig reducedMotion="user">
      {!hasHero && <h1 className="sr-only">{branding?.name || t('home.meta_title')}</h1>}
      {sortedSections.map((section, index) => (
        <FeatureErrorBoundary
          key={section.id || `${section.type}-${index}`}
          featureName={`landing:${section.type}`}
          fallback={null}
        >
          <RenderSection section={section} />
        </FeatureErrorBoundary>
      ))}
      <PublicDiscoveryLinks />
    </MotionConfig>
  );
}
