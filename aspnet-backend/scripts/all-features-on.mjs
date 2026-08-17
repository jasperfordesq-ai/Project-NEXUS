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

function constKeys(name) {
  const block = php.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`));
  if (!block) {
    console.error(`Could not find ${name} in ${source}`);
    process.exit(1);
  }
  const keys = [...block[1].matchAll(/'([a-z0-9_]+)'\s*=>/g)].map((m) => m[1]);
  if (keys.length === 0) {
    console.error(`${name} parsed but no keys found — has its shape changed?`);
    process.exit(1);
  }
  return keys;
}

// 🔴 MODULE_DEFAULTS is included as well, and that is not tidiness.
//
// `wallet`, `listings` and `messages` are MODULES, not features, so they are
// absent from FEATURE_DEFAULTS. But several Laravel controllers check them with
// `TenantContext::hasFeature()` — WalletFeaturesController::listCategories is one
// — and hasFeature() merges the tenant's JSON over FEATURE_DEFAULTS only. A key
// that appears in neither is simply missing, and `!empty()` reads missing as OFF.
//
// Because this script's output REPLACES tenants.features wholesale, a module name
// left out here reads as disabled. Measured: /api/v2/wallet/categories answered
// Laravel's feature-disabled body `{"balance":0,"enabled":false}` while ASP.NET
// returned real categories, so the harness was comparing a switched-off endpoint
// against a working one and reporting it as a contract difference.
//
// Same trap as the CORS subdomain allowlist: writing a replacement value silently
// drops whatever the defaults would have supplied.
const keys = [...new Set([...constKeys('FEATURE_DEFAULTS'), ...constKeys('MODULE_DEFAULTS')])];

process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((k) => [k, true]))));
