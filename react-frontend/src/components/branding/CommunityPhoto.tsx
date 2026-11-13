// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's own photo (Admin → "Make it yours" → "Community photo";
 * AWID feedback, Nov 2026: "warmth, and community"). Shown in ONE place
 * only: the home page, under the welcome banner's words and buttons. The
 * owner took it off the sign-in form, the join page, the new member's
 * welcome step, the feed and Explore on 13 Nov 2026 ("in too many places...
 * very repetitive"), and off the dashboard welcome panel the same day ("too
 * small, and it doesn't look right"). Do not add it to another page without
 * being asked.
 *
 * It is decoration beside the community's name and tagline, which are text,
 * so it carries no alt text. When the community has no photo — or the photo
 * fails to load — the fallback shows instead, never a broken picture.
 *
 * 🔴 On a page it is a FRAMED PICTURE, two wide to one tall — pass `framed`
 * and a width, never a height. On the feed and Explore it was a fixed-height
 * band across the full width of the header, which on a laptop is a box eight
 * times wider than it is tall: about a fifth of the photo showed, and it read
 * as a stretched strip (owner, 13 Nov 2026: "the dimensions are all out of
 * proportion"). A ratio cannot do that at any width.
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

/**
 * The picture frame: the shape, the rounded corners and the border that sets
 * the photo off from the page. The home page and the admin's plain preview
 * both use this one, so they cannot drift apart.
 */
export const COMMUNITY_PHOTO_FRAME =
  'aspect-[2/1] rounded-3xl shadow-[var(--shadow-card)] ring-4 ring-[var(--surface-solid)]';

interface CommunityPhotoProps {
  /**
   * Classes for the <img>. With `framed`, give a width only (and a cap, such
   * as `w-full max-w-md`); without it, give a size.
   */
  className?: string;
  /** Show it as the framed two-to-one picture. See COMMUNITY_PHOTO_FRAME. */
  framed?: boolean;
  /** What to show when there is no photo, or it fails to load. */
  fallback?: ReactNode;
  'data-testid'?: string;
}

export function CommunityPhoto({
  className = '',
  framed = false,
  fallback = null,
  'data-testid': testId,
}: CommunityPhotoProps) {
  const src = useCommunityPhotoUrl();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt=""
      decoding="async"
      className={`object-cover ${framed ? `${COMMUNITY_PHOTO_FRAME} ` : ''}${className}`}
      onError={() => setFailedSrc(src)}
      data-testid={testId}
    />
  );
}

export default CommunityPhoto;
