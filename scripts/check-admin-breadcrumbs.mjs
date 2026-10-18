// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-admin-breadcrumbs.mjs — Prevent hardcoded English breadcrumbs.
 *
 * AdminBreadcrumbs auto-generates breadcrumbs from the URL. If a URL segment
 * is NOT in SEGMENT_LABEL_KEYS, it falls back to humanizeSegment() which
 * renders hardcoded English (e.g. "Pipeline", "Bias Audit"). That's a bug —
 * the breadcrumb should be translatable.
 *
 * This check scans react-frontend/src/admin/routes.tsx for every URL segment
 * and verifies each is mapped in AdminBreadcrumbs.tsx's SEGMENT_LABEL_KEYS,
 * and that the referenced admin.breadcrumbs.<key> exists in en/admin_nav.json.
 *
 * Exit 0 = all admin URL segments are translatable.
 * Exit 1 = at least one segment falls back to hardcoded English.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'react-frontend/src/admin/routes.tsx');
const BREADCRUMBS = path.join(ROOT, 'react-frontend/src/admin/components/AdminBreadcrumbs.tsx');
// The breadcrumb labels live in the admin_nav namespace (AdminBreadcrumbs.tsx
// reads `breadcrumbs.*` from it); this read `admin.json`, which has no such
// block, from the day the check left CI (2026-04-22) until 2026-10-18.
const EN_ADMIN = path.join(ROOT, 'react-frontend/public/locales/en/admin_nav.json');

const routesSrc = fs.readFileSync(ROUTES, 'utf8');
const bcSrc = fs.readFileSync(BREADCRUMBS, 'utf8');
const enAdmin = JSON.parse(fs.readFileSync(EN_ADMIN, 'utf8'));

const segments = new Set();
for (const m of routesSrc.matchAll(/path="([^"]+)"/g)) {
  const p = m[1];
  if (p === '*' || p === '') continue;
  for (const seg of p.split('/')) {
    if (!seg) continue;
    if (seg === '*') continue;
    if (seg.startsWith(':')) continue;
    if (/^\d+$/.test(seg)) continue;
    segments.add(seg);
  }
}

const mapped = new Map();
for (const m of bcSrc.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'(breadcrumbs\.[a-z0-9_]+)'/gm)) {
  mapped.set(m[1], m[2].replace('breadcrumbs.', ''));
}

const unmapped = [];
const missingInLocale = [];
for (const seg of segments) {
  const leafKey = mapped.get(seg);
  if (!leafKey) {
    unmapped.push(seg);
    continue;
  }
  if (!enAdmin.breadcrumbs || !(leafKey in enAdmin.breadcrumbs)) {
    missingInLocale.push({ seg, leafKey });
  }
}

console.log('============================================================');
console.log('  Admin Breadcrumb Coverage Check');
console.log('============================================================');
console.log(`  Total admin URL segments: ${segments.size}`);
console.log(`  Mapped in SEGMENT_LABEL_KEYS: ${mapped.size}`);
console.log(`  Unmapped (would render hardcoded English): ${unmapped.length}`);
console.log(`  Mapped but missing from en/admin_nav.json: ${missingInLocale.length}`);

if (unmapped.length > 0) {
  console.error('');
  console.error('  ✗ Unmapped URL segments — fall back to humanizeSegment() (hardcoded English):');
  for (const s of unmapped) console.error(`    - ${s}`);
  console.error('');
  console.error('  Fix: add each segment to SEGMENT_LABEL_KEYS in AdminBreadcrumbs.tsx');
  console.error('       and add breadcrumbs.<key> to react-frontend/public/locales/en/admin_nav.json');
  process.exit(1);
}

if (missingInLocale.length > 0) {
  console.error('');
  console.error('  ✗ Mapped segments with missing locale values:');
  for (const { seg, leafKey } of missingInLocale) {
    console.error(`    - ${seg} → breadcrumbs.${leafKey}`);
  }
  process.exit(1);
}

console.log('  ✓ All admin URL segments are translatable.');
process.exit(0);
