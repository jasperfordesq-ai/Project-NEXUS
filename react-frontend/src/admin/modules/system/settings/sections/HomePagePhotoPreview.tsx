// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "How it looks on your home page" — under the community photo upload on
 * Admin → "Make it yours" (owner, 13 Nov 2026: "it should have a preview so
 * people can see what's going to appear on the home page").
 *
 * It is the home page's real welcome banner, with the community's own wording
 * and the photo it has just uploaded, drawn small and switched off for clicks
 * — the same frame the landing page editor previews with. Nothing here is a
 * second copy of the design, so the preview cannot drift from the page.
 *
 * A community that has switched its welcome banner off has no photo on its
 * home page at all. The preview says so and points at the editor, rather than
 * showing a banner its visitors never see.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { FeatureErrorBoundary } from '@/components/feedback/FeatureErrorBoundary';
import { HeroSection } from '@/components/landing/HeroSection';
import { shownLandingSections } from '@/components/landing/LandingPageRenderer';
import type { HeroContent, LandingSection } from '@/types';
import { PreviewFrame } from '../../../content/landing-page-builder/SectionPreview';

/** The welcome banner the community's home page shows, or null when it is switched off. */
export function useHomePageBanner(): LandingSection | null {
  const { landingPageConfig } = useTenant();
  return shownLandingSections(landingPageConfig).find((s) => s.type === 'hero') ?? null;
}

export function HomePagePhotoPreview({ banner }: { banner: LandingSection | null }) {
  const { t } = useTranslation('admin_system');
  const { tenantPath } = useTenant();
  const title = t('admin_settings.community_photo_preview_title');

  return (
    <div data-testid="community-photo-home-preview" className="space-y-2">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {banner ? (
        <>
          <PreviewFrame zoom="block" label={title} className="max-w-3xl">
            <FeatureErrorBoundary featureName="admin:community-photo-home-preview" fallback={null}>
              {/* The banner has a full screen's worth of space above and
                  below it; the frame trims some so the photo is not lost in
                  a tall, mostly empty box. */}
              <div className="-my-8 sm:-my-16">
                <HeroSection content={banner.content as HeroContent | undefined} />
              </div>
            </FeatureErrorBoundary>
          </PreviewFrame>
          <p className="text-xs leading-5 text-muted">{t('admin_settings.community_photo_preview_note')}</p>
        </>
      ) : (
        <p className="text-sm leading-6 text-muted">
          {t('admin_settings.community_photo_preview_hero_off')}{' '}
          <Link to={tenantPath('/admin/landing-page')} className="font-medium text-accent underline underline-offset-2">
            {t('admin_settings.community_photo_preview_hero_off_link')}
          </Link>
        </p>
      )}
    </div>
  );
}

export default HomePagePhotoPreview;
