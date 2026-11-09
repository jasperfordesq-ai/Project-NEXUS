// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's own photo (Admin → Settings → "Community photo"; AWID
 * feedback, Nov 2026: "warmth, and community"). Shown on the sign-in and join
 * pages, the dashboard welcome and the feed header.
 *
 * It is decoration beside the community's name and tagline, which are text,
 * so it carries no alt text. When the community has no photo — or the photo
 * fails to load — the fallback shows instead, never a broken picture.
 */

import { useState, type ReactNode } from 'react';
import { useTenant } from '@/contexts';
import { resolveAssetUrl } from '@/lib/helpers';

/** The photo's address, ready for an <img>, or null when there is none. */
export function useCommunityPhotoUrl(): string | null {
  const { branding } = useTenant();
  const photo = branding?.communityPhoto;
  return photo ? resolveAssetUrl(photo) : null;
}

interface CommunityPhotoProps {
  /** Classes for the <img>: give it a size and `object-cover`. */
  className?: string;
  /** What to show when there is no photo, or it fails to load. */
  fallback?: ReactNode;
  'data-testid'?: string;
}

export function CommunityPhoto({ className = '', fallback = null, 'data-testid': testId }: CommunityPhotoProps) {
  const src = useCommunityPhotoUrl();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt=""
      decoding="async"
      className={`object-cover ${className}`}
      onError={() => setFailedSrc(src)}
      data-testid={testId}
    />
  );
}

export default CommunityPhoto;
