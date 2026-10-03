// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Screenshots attached to a "Help & support" request (`/report-a-problem`).
 *
 * Laravel's contract (POST /api/v2/support/reports, multipart) accepts at most
 * three files named `screenshots[0..2]`, each PNG, JPEG or WebP and at most
 * 10 MB. Laravel stays the authority — it re-checks content and re-encodes —
 * but the same limits are enforced here first so a member gets a field-linked
 * GOV.UK error instead of a generic failure, and so oversized data is never
 * forwarded.
 *
 * Upload parsing reuses the shared Formidable middleware, which streams each
 * file to a temporary file on disk (never into memory) and removes it when the
 * response closes. Only files that pass the count and size checks are read into
 * memory for forwarding, so the most this route holds in memory is
 * 3 × 10 MB.
 */

const fs = require('node:fs/promises');
const { parseMultipartForm } = require('../middleware/multipart');

const SCREENSHOT_FIELD = 'screenshots';
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

// The parser's limits sit a little above the product limits on purpose. A
// refusal by the parser abandons the whole body (the member's typed answers are
// lost), whereas a refusal by the route keeps them. So the route refuses a
// fourth file or a slightly-too-large file; the parser only stops a request
// that is clearly abusive. Worst case on disk: 6 × 11 MB of temporary files.
const PARSE_MAX_FILES = 6;
const PARSE_MAX_FILE_BYTES = 11 * 1024 * 1024;
const PARSE_MAX_TOTAL_BYTES = PARSE_MAX_FILES * PARSE_MAX_FILE_BYTES;

const IMAGE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

// Formidable error codes (formidable/src/FormidableError.js).
const FORMIDABLE_MAX_FILES_EXCEEDED = 1015;
const FORMIDABLE_TOTAL_TOO_LARGE = 1009;
const FORMIDABLE_FILE_TOO_LARGE = 1016;

/**
 * Identify a PNG, JPEG or WebP image by its leading bytes. The browser-supplied
 * MIME type and file name are not trusted.
 *
 * @param {Buffer} buffer
 * @returns {string} the image MIME type, or '' when it is none of the three
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG'
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

function uploadedScreenshots(req) {
  const files = req.files || {};
  const value = files[SCREENSHOT_FIELD] || files[`${SCREENSHOT_FIELD}[]`];
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(file => file && typeof file === 'object' && typeof file.filepath === 'string');
}

async function removeScreenshotFiles(files) {
  await Promise.all((files || []).map(async (file) => {
    if (!file || !file.filepath) return;
    try {
      await fs.unlink(file.filepath);
    } catch {
      // Temporary upload cleanup is best-effort; the multipart middleware also
      // removes every parsed file when the response closes.
    }
  }));
}

function safeFilename(name, index, contentType) {
  const basename = String(name || '').replace(/^.*[\\/]/, '');
  const cleaned = Array.from(basename)
    .filter(character => character.charCodeAt(0) >= 0x20 && character !== '"')
    .join('')
    .trim()
    .slice(0, 120);
  return cleaned || `screenshot-${index + 1}.${IMAGE_EXTENSIONS[contentType] || 'img'}`;
}

/**
 * Check the uploaded files against the limits and read the accepted ones.
 *
 * @returns {Promise<{ error: string, screenshots: Array<{buffer: Buffer, filename: string, contentType: string}> }>}
 *   `error` is '' or one of too_many / too_large / invalid_type.
 */
async function prepareScreenshots(files) {
  if (!files || files.length === 0) return { error: '', screenshots: [] };
  if (files.length > MAX_SCREENSHOTS) return { error: 'too_many', screenshots: [] };
  if (files.some(file => Number(file.size) > MAX_SCREENSHOT_BYTES)) {
    return { error: 'too_large', screenshots: [] };
  }

  const screenshots = [];
  for (const [index, file] of files.entries()) {
    const buffer = await fs.readFile(file.filepath);
    if (buffer.length > MAX_SCREENSHOT_BYTES) return { error: 'too_large', screenshots: [] };
    const contentType = detectImageType(buffer);
    if (!contentType) return { error: 'invalid_type', screenshots: [] };
    screenshots.push({
      buffer,
      contentType,
      filename: safeFilename(file.originalFilename, index, contentType)
    });
  }

  return { error: '', screenshots };
}

function screenshotErrorMessage(t, key) {
  return t(`report_problem.screenshots.errors.${key}`);
}

function parserErrorKey(error) {
  const code = Number(error?.code);
  if (code === FORMIDABLE_MAX_FILES_EXCEEDED) return 'too_many';
  if (code === FORMIDABLE_FILE_TOO_LARGE || code === FORMIDABLE_TOTAL_TOO_LARGE
    || Number(error?.httpCode) === 413 || Number(error?.status) === 413) {
    return 'too_large';
  }
  if (Number.isInteger(code) && code >= 1000 && code < 1100) return 'failed';
  return '';
}

/**
 * The parser refused the upload outright (clearly too many or too large files).
 * The rest of the form could not be read, so send the member back to the form
 * with the error linked to the screenshots field rather than to a generic
 * error page.
 */
function reportProblemUploadErrorRedirect(error, req, res, next) {
  const key = parserErrorKey(error);
  if (!key) return next(error);

  const t = typeof res.locals.t === 'function' ? res.locals.t : (value) => value;
  if (req.session) {
    req.session.reportProblemForm = {
      values: {},
      errors: { screenshots: screenshotErrorMessage(t, key) }
    };
  }
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor('/report-a-problem?return=%2F&status=invalid'));
}

const reportProblemUploadMiddleware = [
  parseMultipartForm({
    multiples: true,
    maxFileSize: PARSE_MAX_FILE_BYTES,
    maxFiles: PARSE_MAX_FILES,
    maxTotalFileSize: PARSE_MAX_TOTAL_BYTES
  }),
  reportProblemUploadErrorRedirect
];

module.exports = {
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  detectImageType,
  prepareScreenshots,
  removeScreenshotFiles,
  reportProblemUploadMiddleware,
  screenshotErrorMessage,
  uploadedScreenshots
};
