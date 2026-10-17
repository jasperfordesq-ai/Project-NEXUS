// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Live preview for the landing page editor.
 *
 * Renders the *real* public section components with the draft content, so what
 * the admin sees is what visitors get — no second copy of the design to drift.
 * Two things make that honest:
 *
 *  - the admin is signed in, but visitors are not, and the hero and final
 *    invitation change for signed-in users (the hero swaps its buttons, the
 *    invitation disappears). The preview wraps the sections in an auth context
 *    that says "signed out";
 *  - the preview is scaled with CSS `zoom` and marked `inert`, so nothing in it
 *    can be clicked, focused or followed. Media queries still see the real
 *    viewport, so the layout is the desktop one visitors on a laptop get.
 */

import type { ReactNode } from 'react';
import AuthContext from '@/contexts/AuthContext';
import { useAuth } from '@/contexts';
import {
  HeroSection,
  FeaturePillsSection,
  StatsSection,
  HowItWorksSection,
  CoreValuesSection,
  CtaSection,
} from '@/components/landing';
import { AudienceCardsSection } from '@/components/landing/AudienceCardsSection';
import type {
  AudienceCardsContent,
  CoreValuesContent,
  CtaContent,
  FeaturePillsContent,
  HeroContent,
  HowItWorksContent,
  LandingSection,
  StatsContent,
} from '@/types/landing-page';
import { cleanConfig, sortedSections } from './configUtils';

/** The section as a visitor who is not signed in sees it. */
function AsSignedOutVisitor({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return (
    <AuthContext.Provider value={{ ...auth, isAuthenticated: false, user: null }}>
      {children}
    </AuthContext.Provider>
  );
}

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
      return null;
  }
}

const ZOOM_CLASS = {
  block: '[zoom:0.55]',
  page: '[zoom:0.4]',
} as const;

/**
 * A scaled, non-interactive frame around public page content. The scroll
 * container is the outer element, so a long whole-page preview can still be
 * scrolled even though its contents are inert.
 */
export function PreviewFrame({
  children,
  zoom,
  className = '',
  label,
}: {
  children: ReactNode;
  zoom: keyof typeof ZOOM_CLASS;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden rounded-xl border border-border bg-background ${className}`}
    >
      <div inert className={`pointer-events-none select-none ${ZOOM_CLASS[zoom]}`}>
        <AsSignedOutVisitor>{children}</AsSignedOutVisitor>
      </div>
    </div>
  );
}

/** One block, with its draft wording, cleaned the way the server would store it. */
export function SectionPreview({ section, label }: { section: LandingSection; label: string }) {
  const cleaned = cleanConfig({ sections: [section] }).sections[0]!;
  return (
    <PreviewFrame zoom="block" label={label}>
      <RenderSection section={cleaned} />
    </PreviewFrame>
  );
}

/** Every shown block in order — the page as it would be saved. */
export function WholePagePreview({ sections, label }: { sections: LandingSection[]; label: string }) {
  const shown = sortedSections(cleanConfig({ sections }).sections).filter((s) => s.enabled);
  return (
    <PreviewFrame zoom="page" label={label} className="max-h-[32rem] overflow-y-auto">
      {shown.map((section) => (
        <RenderSection key={section.id} section={section} />
      ))}
    </PreviewFrame>
  );
}
