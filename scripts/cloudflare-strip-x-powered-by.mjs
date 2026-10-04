// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Ensure every Cloudflare zone on the account strips the "X-Powered-By" response
// header at the edge. The platform's origin (Plesk/Apache) adds "X-Powered-By:
// PleskLin" and there is no clean server-wide switch for it on this setup, so we
// remove it in Cloudflare instead. Idempotent: run it any time, and again after
// adding a new domain — zones that already have the rule are left untouched.
// Security register E-089, observation O-181.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=<token> node scripts/cloudflare-strip-x-powered-by.mjs
//   node scripts/cloudflare-strip-x-powered-by.mjs --dry-run   # report only
//
// The token must have, across All zones: Zone > Zone > Read, and
// Zone > Transform Rules > Edit. It is NOT committed (this repo is public):
// pass it in CLOUDFLARE_API_TOKEN, or put it in one of these files (first wins):
//   .secrets.local/cloudflare-transform-token
//   .secrets.local/cloudflare-api-token
//   /opt/nexus-php/.cloudflare-api-token   (production)

import { readFile } from 'node:fs/promises';

const API = 'https://api.cloudflare.com/client/v4';
const HEADER = 'X-Powered-By';
const RULE_DESCRIPTION = 'Remove X-Powered-By (E-089 O-181)';
const PHASE = 'http_response_headers_transform';
const DRY_RUN = process.argv.includes('--dry-run');

async function resolveToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim();
  const candidates = [
    '.secrets.local/cloudflare-transform-token',
    '.secrets.local/cloudflare-api-token',
    '/opt/nexus-php/.cloudflare-api-token',
  ];
  for (const path of candidates) {
    try {
      const value = (await readFile(path, 'utf8')).trim();
      if (value) return value;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'No Cloudflare API token. Set CLOUDFLARE_API_TOKEN, or create ' +
      '.secrets.local/cloudflare-transform-token with a token that has ' +
      'Zone:Read + Transform Rules:Edit across all zones.',
  );
}

async function cf(token, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!body || body.success !== true) {
    const msg = body?.errors?.map((e) => (e.code ? `${e.code} ${e.message}` : e.message)).join('; ') || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body.result;
}

async function listZones(token) {
  const zones = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${API}/zones?per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!body.success) {
      throw new Error(body.errors?.map((e) => (e.code ? `${e.code} ${e.message}` : e.message)).join('; ') || `HTTP ${res.status}`);
    }
    zones.push(...body.result.map((z) => ({ id: z.id, name: z.name })));
    const info = body.result_info;
    if (!info || page >= info.total_pages) break;
  }
  return zones.sort((a, b) => a.name.localeCompare(b.name));
}

// Does a rule already remove our header?
function ruleRemovesHeader(rule) {
  const op = rule?.action_parameters?.headers?.[HEADER]?.operation;
  return rule?.action === 'rewrite' && op === 'remove';
}

async function getEntrypointRules(token, zoneId) {
  try {
    const result = await cf(token, `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
    return result.rules || [];
  } catch (err) {
    // No entrypoint ruleset yet for this phase — Cloudflare returns an error; treat as empty.
    if (/could not find|does not exist|10..\b|not found/i.test(String(err.message))) return [];
    throw err;
  }
}

async function ensureZone(token, zone) {
  const rules = await getEntrypointRules(token, zone.id);
  if (rules.some(ruleRemovesHeader)) return 'already-present';
  if (DRY_RUN) return 'would-add';

  const newRule = {
    action: 'rewrite',
    action_parameters: { headers: { [HEADER]: { operation: 'remove' } } },
    expression: 'true',
    description: RULE_DESCRIPTION,
    enabled: true,
  };
  // Preserve any existing rules; append ours. PUT replaces the entrypoint's rule list.
  const kept = rules.map((r) => ({
    action: r.action,
    action_parameters: r.action_parameters,
    expression: r.expression,
    description: r.description,
    enabled: r.enabled,
    ...(r.ref ? { ref: r.ref } : {}),
  }));
  await cf(token, `/zones/${zone.id}/rulesets/phases/${PHASE}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules: [...kept, newRule] }),
  });
  return 'added';
}

async function main() {
  const token = await resolveToken();
  const zones = await listZones(token);
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Checking ${zones.length} zone(s) for the ${HEADER} strip rule.\n`);

  const counts = { added: 0, 'already-present': 0, 'would-add': 0, error: 0 };
  for (const zone of zones) {
    try {
      const outcome = await ensureZone(token, zone);
      counts[outcome] += 1;
      const label = { added: 'ADDED', 'already-present': 'ok (already set)', 'would-add': 'WOULD ADD', error: 'ERROR' }[outcome];
      console.log(`  ${zone.name.padEnd(28)} ${label}`);
    } catch (err) {
      counts.error += 1;
      console.log(`  ${zone.name.padEnd(28)} ERROR: ${err.message}`);
    }
  }

  console.log(
    `\nDone: ${counts.added} added, ${counts['already-present']} already set` +
      (DRY_RUN ? `, ${counts['would-add']} would add` : '') +
      `, ${counts.error} error(s).`,
  );
  process.exit(counts.error > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
