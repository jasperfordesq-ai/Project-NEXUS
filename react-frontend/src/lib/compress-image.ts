// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Client-side image compression using the Canvas API.
 *
 * Resizes images to a maximum width while preserving aspect ratio,
 * then re-encodes as JPEG at the given quality level.
 * No external dependencies — pure browser Canvas API.
 */

/**
 * Compress an image file by resizing and re-encoding as JPEG.
 *
 * @param file      - The original File to compress.
 * @param maxWidth  - Maximum width in pixels (default 1920). Height scales proportionally.
 * @param quality   - JPEG quality from 0 to 1 (default 0.85).
 * @returns A new File with the compressed image, or the original if no compression was needed.
 */
export async function compressImage(
  file: File,
  maxWidth = 1920,
  quality = 0.85,
): Promise<File> {
  // Non-image files pass through unchanged
  if (!file.type.startsWith('image/')) {
    return file;
  }

  // Skip compression for GIFs (preserves animation) and WebP (already efficient)
  if (file.type === 'image/gif' || file.type === 'image/webp') {
    return file;
  }

  // Load the image into an HTMLImageElement
  const img = await loadImage(file);

  // If the image is already within bounds, return the original
  if (img.naturalWidth <= maxWidth) {
    return file;
  }

  // Calculate scaled dimensions preserving aspect ratio
  const ratio = maxWidth / img.naturalWidth;
  const targetWidth = maxWidth;
  const targetHeight = Math.round(img.naturalHeight * ratio);

  // Draw to an offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Canvas 2D context unavailable (e.g. OffscreenCanvas not supported) — return original
    return file;
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Convert canvas to a JPEG blob
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  // Preserve the original filename, swapping extension to .jpg
  const name = replaceExtension(file.name, '.jpg');

  return new File([blob], name, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

/**
 * Read an image file's pixel dimensions without uploading it.
 *
 * Resolves `null` when the browser cannot decode the file (an unsupported
 * format, a corrupt file) so callers can fall back to the server's own check
 * rather than refusing an image the server would have accepted.
 */
export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    const img = await loadImage(file);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
}

/**
 * Load a File into an HTMLImageElement via an object URL.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Promise wrapper around `canvas.toBlob()`.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Replace a filename's extension while preserving the base name.
 * If the file has no extension, the new extension is appended.
 */
function replaceExtension(filename: string, newExt: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) {
    return filename + newExt;
  }
  return filename.substring(0, dotIndex) + newExt;
}
