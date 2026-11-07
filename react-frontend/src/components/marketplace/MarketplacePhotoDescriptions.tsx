// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplacePhotoDescriptions — one "describe this photo" box per listing photo.
 *
 * AWID accessibility report, Oct 2026, point 6: blind members heard nothing
 * useful about a marketplace photo because a seller had nowhere to describe
 * it. The create and edit pages render this under their photo grid; each
 * description is sent as `alt_texts[i]` with a new photo, or in
 * `image_alt_texts` (keyed by photo id) for a photo already saved.
 * Same 255-character limit as a listing photo (`listings.image_alt`).
 */

import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';

/** Mirrors the API's `max:255` rule on photo descriptions. */
export const MARKETPLACE_PHOTO_ALT_MAX = 255;

export interface DescribablePhoto {
  id: string;
  url: string;
  altText: string;
}

interface MarketplacePhotoDescriptionsProps {
  photos: DescribablePhoto[];
  onChange: (id: string, altText: string) => void;
}

export function MarketplacePhotoDescriptions({ photos, onChange }: MarketplacePhotoDescriptionsProps) {
  const { t } = useTranslation('marketplace');

  if (photos.length === 0) return null;

  return (
    <ul className="space-y-3">
      {photos.map((photo, idx) => (
        <li key={photo.id} className="flex items-start gap-3">
          {/* The label names the photo by number; the small copy only helps sighted sellers match them up. */}
          <img src={photo.url} alt="" className="mt-6 size-12 shrink-0 rounded-md object-cover" />
          <Input
            className="min-w-0 flex-1"
            label={t('create.image_alt_label', { number: idx + 1 })}
            description={t('create.image_alt_hint')}
            value={photo.altText}
            onValueChange={(value) => onChange(photo.id, value)}
            maxLength={MARKETPLACE_PHOTO_ALT_MAX}
          />
        </li>
      ))}
    </ul>
  );
}
