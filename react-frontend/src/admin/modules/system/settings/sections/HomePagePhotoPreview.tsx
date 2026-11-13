// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The picture of the home page under the community photo upload on
 * Admin → "Make it yours" (owner, 13 Nov 2026: "it should have a preview so
 * people can see what's going to appear on the home page").
 *
 * It is the home page's real welcome banner, with the community's own wording,
 * drawn small and switched off for clicks — the same frame the landing page
 * editor previews with. Nothing here is a second copy of the design, so the
 * preview cannot drift from the page.
 *
 * With a photo it is "How it looks on your home page". Before there is one it
 * is "Where it will go on your home page": the same banner with a dashed box
 * in the photo's place (owner, 13 Nov 2026: "we need better instructions… to
 * say where the community photo will go on the landing page"). The box is the
 * photo's own shape and width, so it cannot mark the wrong spot.
 *
 * A community that has switched its welcome banner off has no photo on its
 * home page at all. The preview says so and points at the editor, rather than
 * showing a banner its visitors never see.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Camera from 'lucide-react/icons/camera';
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

interface HomePagePhotoPreviewProps {
  banner: LandingSection | null;
  /** Whether the community has uploaded its photo yet. */
  hasPhoto: boolean;
}

export function HomePagePhotoPreview({ banner, hasPhoto }: HomePagePhotoPreviewProps) {
  const { t } = useTranslation('admin_system');
  const { tenantPath } = useTenant();
  const title = hasPhoto
    ? t('admin_settings.community_photo_preview_title')
    : t('admin_settings.community_photo_where_title');

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
                <HeroSection
                  content={banner.content as HeroContent | undefined}
                  photoPlaceholder={
                    // The photo's own shape and width (see COMMUNITY_PHOTO_FRAME
                    // and the banner), as a dashed outline instead of a picture.
                    <div
                      data-testid="community-photo-placeholder"
                      className="flex aspect-[2/1] w-full max-w-md flex-col items-center justify-center gap-3 rounded-3xl border-4 border-dashed border-accent bg-accent-soft px-4 text-center text-theme-primary"
                    >
                      <Camera className="size-10" aria-hidden="true" />
                      <span className="text-xl font-semibold">{t('admin_settings.community_photo_placeholder')}</span>
                    </div>
                  }
                />
              </div>
            </FeatureErrorBoundary>
          </PreviewFrame>
          <p className="text-xs leading-5 text-muted">
            {hasPhoto
              ? t('admin_settings.community_photo_preview_note')
              : t('admin_settings.community_photo_where_note')}
          </p>
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
