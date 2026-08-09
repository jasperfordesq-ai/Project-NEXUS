// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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

function parseMultipartForm(options = {}) {
  return (req, _res, next) => {
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

    return form.parse(req, (error, fields, files) => {
      if (error) {
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
      if (req.body._csrf && !req.headers['x-csrf-token']) {
        req.headers['x-csrf-token'] = req.body._csrf;
      }
      return next();
    });
  };
}

module.exports = {
  parseMultipartForm
};
