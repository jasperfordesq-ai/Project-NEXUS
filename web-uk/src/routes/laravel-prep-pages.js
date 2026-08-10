// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const ROUTE_MATRIX_PATH = path.join(__dirname, '..', '..', 'docs', 'generated', 'accessible-route-matrix.json');

function loadRouteMatrix() {
  if (!fs.existsSync(ROUTE_MATRIX_PATH)) {
    return { matrix: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(ROUTE_MATRIX_PATH, 'utf8'));
  } catch {
    return { matrix: [] };
  }
}

const routeMatrix = loadRouteMatrix();

function toExpressPath(laravelPath, paramConstraints = []) {
  let paramIndex = 0;
  return laravelPath.replace(/\{param\}/g, () => {
    const constraint = paramConstraints[paramIndex];
    paramIndex += 1;
    return constraint === 'number' ? `:param${paramIndex}(\\d+)` : `:param${paramIndex}`;
  });
}

function humanize(value) {
  return String(value || 'Laravel accessible route')
    .replace(/^accessible-frontend::/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeSpecificity(page) {
  const paramCount = (page.expressPath.match(/:/g) || []).length;
  const segmentCount = page.expressPath.split('/').filter(Boolean).length;
  return [paramCount, -segmentCount, page.expressPath];
}

function compareSpecificity(left, right) {
  const a = routeSpecificity(left);
  const b = routeSpecificity(right);

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }

  return 0;
}

const prepPages = routeMatrix.matrix
  .filter((row) => row.status === 'missing' && row.method === 'GET' && row.laravelHandler)
  .map((row) => ({
    title: humanize(row.laravelView || row.laravelHandler || row.path),
    laravelPath: row.path,
    expressPath: toExpressPath(row.path, row.laravelParamConstraints || []),
    handler: row.laravelHandler,
    bladeView: row.laravelView || '',
    auth: row.auth || '',
    gates: row.gates || ''
  }))
  .sort(compareSpecificity);

for (const page of prepPages) {
  router.get(page.expressPath, (req, res) => {
    const viewNote = page.bladeView ? ` and Blade view ${page.bladeView}` : '';
    res.render('static-page', {
      title: page.title,
      body: `Laravel Blade route ${page.laravelPath} (${page.handler}${viewNote}) is present as an accessible preparation page. The full workflow still needs to be ported and certified against the Laravel source of truth.`,
      returnUrl: req.query.return || ''
    });
  });
}

module.exports = router;
module.exports.prepPages = prepPages;
