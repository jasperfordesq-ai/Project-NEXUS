// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shrink a picked photo to something a phone on mobile data can actually upload.
 *
 * 🔴 Why this exists. Every `ImagePicker.launchImageLibraryAsync` call in the app passed
 * `quality: 0.82`–`0.88` and nothing else. `quality` only re-encodes — it does not resize —
 * so a photo from a modern phone camera (12 to 48 megapixels) still left the device at its
 * full pixel dimensions, typically 3–8 MB. The server's own limit is 8 MB
 * (`app/Core/ImageUploader.php`) and the client's upload timeout is 60 seconds
 * (`TIMEOUTS.API_UPLOAD`), so on a slow connection the member waited out the whole minute
 * and was then told the upload had failed, with nothing to do differently. Audit
 * 2026-09-09, item 6.
 *
 * 1600px on the longest edge is well above what any screen in the app displays — the
 * largest is a full-width marketplace photo — and brings a typical camera photo under
 * 400 KB. Marketplace listing photos get 2048, because a buyer zooms into them.
 *
 * 🔴 Never blocks the upload. Every failure path returns the original asset: a member
 * whose photo could not be resized should still be able to post it, and the server's own
 * limit remains the real boundary. The resize is an improvement, not a gate.
 *
 * 🔴 PNG stays PNG. Re-encoding a transparent logo as JPEG fills its transparency with
 * black, and the organisation logo picker is one of the callers. Resizing alone still
 * removes most of the weight.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { reportException } from '@/lib/observability/report';

/** Longest edge, in pixels, for an ordinary photo. */
export const DEFAULT_MAX_EDGE = 1600;

/** Longest edge for marketplace listing photos, which a buyer zooms into. */
export const MARKETPLACE_MAX_EDGE = 2048;

/** JPEG quality for the re-encode. Visually indistinguishable at these sizes. */
const DEFAULT_COMPRESS = 0.8;

export interface PickedImage {
  uri: string;
  width?: number | null;
  height?: number | null;
}

export interface PreparedImage {
  uri: string;
  width?: number | null;
  height?: number | null;
}

export interface PrepareImageOptions {
  /** Longest edge to allow. Defaults to {@link DEFAULT_MAX_EDGE}. */
  maxEdge?: number;
  /** JPEG quality, 0–1. Ignored for PNG sources. */
  compress?: number;
}

function isPng(uri: string): boolean {
  return /\.png(\?|$)/i.test(uri);
}

/**
 * Returns the asset to upload: a resized copy when the original is larger than `maxEdge`,
 * and the original otherwise.
 */
export async function prepareImageForUpload(
  asset: PickedImage,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const { uri, width, height } = asset;

  if (!uri) return asset;

  /*
    The picker reports dimensions for a library asset. When it does and the photo is already
    small enough, there is nothing to gain from a re-encode — and a re-encode of an already
    small image can make it BIGGER. When it does not report them (some providers), fall
    through and let the resize decide; asking for a longest edge no larger than the original
    is a no-op in the native module.
  */
  const longestEdge = Math.max(width ?? 0, height ?? 0);
  if (longestEdge > 0 && longestEdge <= maxEdge) return asset;

  try {
    const context = ImageManipulator.manipulate(uri);

    /*
      Only one dimension is given, so the module preserves the aspect ratio. Which one
      depends on the orientation: constraining the width of a tall photo would leave it
      taller than the cap.
    */
    if ((width ?? 0) >= (height ?? 0)) {
      context.resize({ width: maxEdge });
    } else {
      context.resize({ height: maxEdge });
    }

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync(
      isPng(uri)
        ? { format: SaveFormat.PNG }
        : { format: SaveFormat.JPEG, compress: options.compress ?? DEFAULT_COMPRESS },
    );

    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch (error) {
    // Reported so a systematic failure is visible, but never surfaced to the member: the
    // original still uploads, and the server decides whether it is too big.
    reportException(error, { tags: { module: 'prepare-image-for-upload' } });
    return asset;
  }
}
