// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace listing photos — the shared upload step used by the listing create form and
 * the listing's own photos page (26 Oct 2026).
 *
 * `uploadMarketplaceListingImages` existed in lib/api.js and nothing called it, so a seller
 * on the accessible site could never add, replace or remove a photo. Laravel accepts
 * JPEG, PNG, WebP and GIF (`MarketplaceListingController::uploadImagesForListing`, which
 * checks the detected type AND the extension) and silently skips anything else, so the
 * same check runs here first: a member who picks a PDF is told which file was wrong
 * instead of getting a generic failure after the round trip.
 */

const fs = require('fs/promises');
const { randomUUID } = require('node:crypto');
const { uploadMarketplaceListingImages } = require('./api');

const MAX_PHOTOS_PER_UPLOAD = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// Extension -> the one type Laravel will accept for it.
const EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
};

function filesFrom(req, field = 'images') {
  const value = req.files && req.files[field];
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((file) => file && typeof file === 'object' && typeof file.filepath === 'string' && file.filepath !== '');
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/** `true` when the file's name and declared type agree on an accepted image type. */
function isAcceptedPhoto(file) {
  const expected = EXTENSION_TYPES[extensionOf(file.originalFilename)];
  return Boolean(expected) && String(file.mimetype || '').toLowerCase() === expected;
}

/**
 * Check the chosen files before anything is sent.
 * Returns '' when they are fine, or the translation key of the problem.
 */
function photoProblem(files) {
  if (files.length === 0) return 'govuk_alpha_commerce.photos.error_none';
  if (files.length > MAX_PHOTOS_PER_UPLOAD) return 'govuk_alpha_commerce.photos.error_too_many';
  if (files.some((file) => !isAcceptedPhoto(file))) return 'govuk_alpha_commerce.photos.error_type';
  if (files.some((file) => Number(file.size) > MAX_PHOTO_BYTES)) return 'govuk_alpha_commerce.photos.error_size';
  return '';
}

async function removeFiles(files) {
  await Promise.all(files.map((file) => fs.unlink(file.filepath).catch(() => {})));
}

/** Send the photos to Laravel in one request. Throws whatever the API throws. */
async function uploadListingPhotos(token, listingId, files) {
  try {
    const payload = await Promise.all(files.map(async (file) => ({
      buffer: await fs.readFile(file.filepath),
      filename: String(file.originalFilename || '').trim() || 'listing-photo',
      contentType: String(file.mimetype || '').trim() || 'application/octet-stream',
      size: file.size
    })));
    return await uploadMarketplaceListingImages(token, listingId, {
      files: payload,
      idempotencyKey: `accessible-marketplace-photos-${randomUUID()}`
    });
  } finally {
    await removeFiles(files);
  }
}

module.exports = {
  MAX_PHOTOS_PER_UPLOAD,
  MAX_PHOTO_BYTES,
  filesFrom,
  photoProblem,
  removeFiles,
  uploadListingPhotos
};
