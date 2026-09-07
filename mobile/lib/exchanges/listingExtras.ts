// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The writes that follow a listing being saved: its skill tags, and its photo.
 *
 * 🔴 They are separate requests from the listing itself, and each can fail on its own.
 * That is the whole problem this module exists to make manageable (audit 2026-09-06, F06).
 * Before it, a failed tag or image write showed a toast and the screen then navigated to
 * the listing anyway — so the member's tags and their chosen photo were gone, with nothing
 * to press. Worse, the only "retry" available to them was to fill the form in again, which
 * on the create screen means a SECOND listing.
 *
 * Two rules hold everywhere this is used:
 *
 *  - Each write is attempted independently. One failing must not skip the other, or the
 *    member is told two things failed when one did.
 *  - A retry re-sends ONLY what failed (`remainingListingExtras`). Re-sending a write
 *    that already landed is how the same work gets applied twice, and the listing itself
 *    is NEVER part of a retry — it is already saved.
 */

import {
  deleteExchangeImage,
  setExchangeTags,
  uploadExchangeImage,
} from '@/lib/api/exchanges';

export interface ListingExtras {
  /** Tags to write, or null when there is nothing to write. */
  tags: string[] | null;
  /** A newly chosen photo to upload, or null. */
  imageUri: string | null;
  /** Remove the listing's existing photo. Ignored when `imageUri` is set. */
  removeImage: boolean;
}

export interface ListingExtrasResult {
  tagsFailed: boolean;
  imageFailed: boolean;
  /** Kept so the screen can show the server's own words rather than a generic apology. */
  tagsError?: unknown;
  imageError?: unknown;
}

export const NO_LISTING_EXTRAS: ListingExtras = { tags: null, imageUri: null, removeImage: false };

export function hasListingExtras(extras: ListingExtras): boolean {
  return (extras.tags?.length ?? 0) > 0 || extras.imageUri !== null || extras.removeImage;
}

export function listingExtrasFailed(result: ListingExtrasResult): boolean {
  return result.tagsFailed || result.imageFailed;
}

/** Attempt every outstanding write against a listing that is ALREADY saved. */
export async function saveListingExtras(
  listingId: number,
  extras: ListingExtras,
): Promise<ListingExtrasResult> {
  const result: ListingExtrasResult = { tagsFailed: false, imageFailed: false };

  if ((extras.tags?.length ?? 0) > 0) {
    try {
      await setExchangeTags(listingId, extras.tags as string[]);
    } catch (err) {
      result.tagsFailed = true;
      result.tagsError = err;
    }
  }

  // Deliberately not an `else if` on the tag result: the two are independent.
  if (extras.imageUri) {
    try {
      await uploadExchangeImage(listingId, extras.imageUri);
    } catch (err) {
      result.imageFailed = true;
      result.imageError = err;
    }
  } else if (extras.removeImage) {
    try {
      await deleteExchangeImage(listingId);
    } catch (err) {
      result.imageFailed = true;
      result.imageError = err;
    }
  }

  return result;
}

/** What a retry should send: the failed writes, and nothing that already landed. */
export function remainingListingExtras(
  extras: ListingExtras,
  result: ListingExtrasResult,
): ListingExtras {
  return {
    tags: result.tagsFailed ? extras.tags : null,
    imageUri: result.imageFailed ? extras.imageUri : null,
    removeImage: result.imageFailed ? extras.removeImage : false,
  };
}
