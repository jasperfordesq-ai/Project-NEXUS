// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Prints a `tenants.features` JSON value with every Laravel feature switched on.
 *
 * 🔴 For the DISPOSABLE comparison fixture only. Fifteen of these default OFF
 * (`App\Services\TenantFeatureConfig::FEATURE_DEFAULTS`) — marketplace, courses,
 * member_premium, podcasts, local_advertising, caring_community, public_events
 * and the rest. A fresh fixture community therefore answers 403 FEATURE_DISABLED
 * on ~27 endpoints, and the response harness stops at the status difference
 * without ever comparing the payload.
 *
 * Switching them all on maximises the comparable surface. It says nothing about
 * what should default on: verifying that a gate correctly REFUSES is a separate
 * check, run against a fixture with the features off.
 *
 * Usage: node aspnet-backend/scripts/all-features-on.mjs [path/to/TenantFeatureConfig.php]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultSource = path.resolve(here, '../../app/Services/TenantFeatureConfig.php');
const source = process.argv[2] ?? defaultSource;

const php = fs.readFileSync(source, 'utf8');
const block = php.match(/FEATURE_DEFAULTS\s*=\s*\[([\s\S]*?)\n\s*\];/);
if (!block) {
  console.error(`Could not find FEATURE_DEFAULTS in ${source}`);
  process.exit(1);
}

const keys = [...block[1].matchAll(/'([a-z0-9_]+)'\s*=>/g)].map((m) => m[1]);
if (keys.length === 0) {
  console.error('FEATURE_DEFAULTS parsed but no keys found — has its shape changed?');
  process.exit(1);
}

process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((k) => [k, true]))));
