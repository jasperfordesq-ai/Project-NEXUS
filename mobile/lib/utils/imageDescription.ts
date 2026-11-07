// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Photo descriptions members write for screen readers (listings.image_alt,
 * events.image_alt via primary_image.description, groups.image_alt / cover_image_alt).
 *
 * The rule every screen follows: read the description when one was written; otherwise keep
 * what the screen did before. Never fall back to a file name.
 */
export function imageDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Label for a card that a screen reader reads as one element (a pressable card hides the
 * photo inside it). The visible title comes first, then the photo's description — so the
 * description is heard without the title being read twice when there is none.
 */
export function labelWithImageDescription(label: string, description: unknown): string {
  const written = imageDescription(description);
  if (!written) return label;
  return label ? `${label}. ${written}` : written;
}

/**
 * A group shows its cover when it has one and its picture otherwise, and each has its own
 * description. Mirrors the `cover_image ?? image_url` choice the screens make.
 */
export function groupPictureDescription(group: {
  cover_image?: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  cover_image_alt?: string | null;
}): string | null {
  if (group.cover_image != null) return imageDescription(group.cover_image_alt);
  return imageDescription(group.image_alt);
}
