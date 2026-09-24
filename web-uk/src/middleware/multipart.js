// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const { AsyncResource } = require('node:async_hooks');
const { formidable } = require('formidable');

function isMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/form-data');
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function flattenFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, firstValue(value)])
  );
}

function flattenFiles(files, keepArrays = false) {
  return Object.fromEntries(
    Object.entries(files || {}).map(([key, value]) => [key, keepArrays ? value : firstValue(value)])
  );
}

function collectFilepaths(files) {
  const paths = [];
  for (const value of Object.values(files || {})) {
    for (const file of Array.isArray(value) ? value : [value]) {
      if (file && typeof file.filepath === 'string' && file.filepath !== '') {
        paths.push(file.filepath);
      }
    }
  }
  return paths;
}

// Upload parsing is mounted ahead of the CSRF, sign-in and route-level checks,
// so a refused request (419, sign-in redirect, early return) never reaches the
// handler that would delete its temp file. Remove every parsed temp file once
// the response has closed; handlers that already unlinked theirs are unaffected
// (ENOENT is ignored).
function removeTempFilesOnClose(res, files) {
  const paths = collectFilepaths(files);
  if (paths.length === 0 || typeof res.once !== 'function') return;
  res.once('close', () => {
    for (const filepath of paths) {
      fs.unlink(filepath, () => {});
    }
  });
}

function parseMultipartForm(options = {}) {
  return (req, res, next) => {
    if (req.files || !isMultipart(req)) {
      return next();
    }

    const form = formidable({
      multiples: options.multiples === true,
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024,
      allowEmptyFiles: false,
      // Browsers submit an empty file part for optional file controls on an
      // otherwise valid multipart form. Ignore that placeholder before
      // Formidable applies its non-empty-file rule; real named uploads retain
      // the existing size and route-level MIME validation.
      filter: part => typeof part.originalFilename === 'string' && part.originalFilename.trim() !== ''
    });

    // F-206: formidable calls back from a later socket event, outside the
    // AsyncLocalStorage context this request started in, so the API calls an
    // upload route made afterwards carried no visitor address (F-110), no
    // language and no community fallback. Binding the callback to the current
    // async context hands control back inside the request's own context.
    return form.parse(req, AsyncResource.bind((error, fields, files) => {
      if (error) {
        // Formidable flags an over-limit upload with httpCode 413. Surface that
        // as a real 413 so the error handler renders the friendly "file is too
        // large" page rather than a bare 500 "problem with the service".
        if (error.httpCode === 413 || error.code === 'biggerThanMaxFileSize' || error.code === 1009) {
          error.status = 413;
        }
        return next(error);
      }

      req.body = {
        ...(req.body || {}),
        ...flattenFields(fields)
      };
      req.files = {
        ...(req.files || {}),
        ...flattenFiles(files, options.multiples === true)
      };
      removeTempFilesOnClose(res, files);
      if (req.body._csrf && !req.headers['x-csrf-token']) {
        req.headers['x-csrf-token'] = req.body._csrf;
      }
      return next();
    }));
  };
}

module.exports = {
  parseMultipartForm
};
