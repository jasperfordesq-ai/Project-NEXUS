// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import ArrowRight from 'lucide-react/icons/arrow-right';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { useTranslation } from 'react-i18next';
import { useTenant, useAuth } from '@/contexts';
import type { HeroContent } from '@/types';
import { CommunityPhoto, useCommunityPhotoUrl } from '@/components/branding/CommunityPhoto';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

/**
 * The headline is the home page's largest paint (LCP). It must be visible in
 * the first frame, so it moves but never fades: an element that starts at
 * opacity 0 does not count as painted until the fade ends (2026-10-23).
 */
const slideUp = {
  initial: { y: 30 },
  animate: { y: 0, transition: { duration: 0.5 } },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

interface HeroSectionProps {
  content?: HeroContent;
  /**
   * Shown in the photo's place when the community has no photo yet. Only the
   * admin's picture of the home page passes one, to mark where an uploaded
   * photo will go. The real home page never does.
   */
  photoPlaceholder?: ReactNode;
}

const scrollToSection = () => {
  document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
};

export function HeroSection({ content, photoPlaceholder }: HeroSectionProps) {
  const { t } = useTranslation('public');
  const { branding, tenantPath, hasModule } = useTenant();
  const { isAuthenticated } = useAuth();

  const hasCommunityPhoto = useCommunityPhotoUrl() !== null;
  const badgeText = content?.badge_text || t('home.badge');
  const headline1 = content?.headline_1 || t('home.headline_1');
  const headline2 = content?.headline_2 || t('home.headline_2');
  const subheadline = content?.subheadline || t('home.subheadline', { name: branding.name });
  const ctaPrimaryText = content?.cta_primary_text || t('home.cta_get_started');
  const ctaPrimaryLink = content?.cta_primary_link || '/register';
  const ctaSecondaryText = content?.cta_secondary_text || t('home.cta_learn_more');
  const ctaSecondaryLink = content?.cta_secondary_link || '/about';
  /**
   * 🔴 The signed-in call to action must respect the community's module switches.
   *
   * It pointed at `/feed` unconditionally. A member of a community that has switched
   * the feed off pressed the biggest button on their own front page and the route
   * guard bounced them to the dashboard — the button named a place they cannot go.
   * `cta_dashboard` was already translated in all eleven locales and unused.
   *
   * With both modules off there is nowhere sensible to send them, so the button is
   * dropped rather than pointed at a third page that also redirects.
   */
  const signedInCta = hasModule('feed')
    ? { link: '/feed', text: t('home.cta_feed') }
    : hasModule('dashboard')
      ? { link: '/dashboard', text: t('home.cta_dashboard') }
      : null;

  return (
    <section aria-labelledby="hero-heading" className="relative py-20 sm:py-32 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          className="text-center"
          initial="initial"
          animate="animate"
          variants={staggerContainer}
        >
          {/* Badge */}
          <motion.div variants={fadeInUp} className="mb-6">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card backdrop-blur-lg text-sm text-theme-muted">
              <span className="text-accent dark:text-accent">✨</span>
              <span>{badgeText}</span>
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            id="hero-heading"
            variants={slideUp}
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold"
          >
            <span className="text-theme-primary">{headline1}</span>
            <br />
            <span className="text-gradient">{headline2}</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            variants={fadeInUp}
            className="mt-6 text-lg sm:text-xl text-theme-muted max-w-2xl mx-auto"
          >
            {subheadline}
          </motion.p>

          {/* CTAs */}
          <motion.div
            variants={fadeInUp}
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
          >
            {isAuthenticated ? (
              signedInCta && (
                <Button
                  as={Link}
                  to={tenantPath(signedInCta.link)}
                  size="lg"
                  className="w-full sm:w-auto bg-gradient-to-r from-accent-strong to-accent-strong-end text-white font-semibold px-8 shadow-lg shadow-accent/25 hover:shadow-accent/50 transition-shadow"
                  endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                >
                  {signedInCta.text}
                </Button>
              )
            ) : (
              <>
                <Button
                  as={Link}
                  to={tenantPath(ctaPrimaryLink)}
                  size="lg"
                  className="w-full sm:w-auto bg-gradient-to-r from-accent-strong to-accent-strong-end text-white font-semibold px-8 shadow-lg shadow-accent/25 hover:shadow-accent/50 transition-shadow"
                  endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                >
                  {ctaPrimaryText}
                </Button>
                <Button
                  as={Link}
                  to={tenantPath(ctaSecondaryLink)}
                  size="lg"
                  variant="bordered"
                  className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                >
                  {ctaSecondaryText}
                </Button>
              </>
            )}
          </motion.div>

          {/* The community's own photo, when it has uploaded one (warmth plan
              P11): the front page was text and buttons only, with nothing of
              the place or its people. It sits under the words and the
              buttons — above the headline it "looked very odd" (owner,
              13 Nov 2026). Decorative (empty alt): the community's name beside
              it is text. With no photo, the admin's picture of this banner
              marks the same spot with a placeholder. */}
          {(hasCommunityPhoto || photoPlaceholder) && (
            <motion.div variants={fadeInUp} className="mt-12 flex justify-center">
              {hasCommunityPhoto ? (
                <CommunityPhoto framed data-testid="landing-hero-photo" className="w-full max-w-md" />
              ) : (
                photoPlaceholder
              )}
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="flex justify-center mt-12"
      >
        <Button
          variant="light"
          className="text-theme-subtle hover:text-theme-primary motion-safe:animate-bounce"
          onPress={scrollToSection}
          isIconOnly
          aria-label={t('home.scroll_down')}
        >
          <ChevronDown className="w-6 h-6" aria-hidden="true" />
        </Button>
      </motion.div>
    </section>
  );
}
