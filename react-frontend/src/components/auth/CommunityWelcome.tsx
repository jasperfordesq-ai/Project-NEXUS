// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The top of the sign-in and join cards: the community's own photo, or a
 * cover in its colour, with its logo (or initials) on it, and its tagline
 * underneath — so
 * the first thing a new member sees is the community, not a form (AWID
 * feedback, Nov 2026: "warmth, and community").
 *
 * It sits flush with the card's edges: pass the negative margins that undo the
 * card's padding (e.g. `-mx-5 -mt-5 sm:-mx-8 sm:-mt-8`), and give the card
 * `overflow-hidden` so the cover follows its rounded corners.
 */

import { useTranslation } from 'react-i18next';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { CommunityPhoto, useCommunityPhotoUrl } from '@/components/branding/CommunityPhoto';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useTenant } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';

export function CommunityWelcome({ className = '' }: { className?: string }) {
  const { t } = useTranslation('common');
  const { branding } = useTenant();
  const palette = useSitePalette();
  const tagline = branding.tagline?.trim() || t('footer.default_tagline');

  const hasPhoto = Boolean(useCommunityPhotoUrl());

  return (
    <div data-testid="community-welcome" className={`mb-6 ${className}`}>
      <div className={`relative ${hasPhoto ? 'h-32 sm:h-40' : 'h-24 sm:h-28'}`}>
        <CommunityPhoto
          data-testid="community-welcome-photo"
          className="absolute inset-0 size-full"
          fallback={<ThemedCover colour={palette[0] ?? 'blue'} data-testid="community-welcome-cover" />}
        />
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div
            data-testid="community-welcome-logo"
            className="rounded-2xl bg-white/85 px-4 py-2 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-black/45 dark:ring-white/10"
          >
            <TenantLogo size="sm" showName={false} />
          </div>
        </div>
      </div>
      <p
        data-testid="community-welcome-tagline"
        className="mt-3 px-5 text-center text-sm font-medium text-theme-secondary sm:px-8"
      >
        {tagline}
      </p>
    </div>
  );
}

export default CommunityWelcome;
