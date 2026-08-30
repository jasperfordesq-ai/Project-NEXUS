// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

function requiredQueryForGetter(getterName, listingId) {
  if (!['getComments', 'getExchangeComments'].includes(getterName) || !listingId) return null;
  return {
    target_type: 'listing',
    target_id: String(listingId),
  };
}

function exitCodeForMissingContracts(missingCount) {
  return missingCount > 0 ? 1 : 0;
}

function classifyGetterBody(body) {
  if (/return\s+api\.get</.test(body)) return 'passthrough';
  if (/\bparseContract\s*\(/.test(body)) return 'validated';
  return 'mapped';
}

function fetchTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function auditOutputOptions(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const jsonIndex = args.indexOf('--json');
  const jsonOut = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
  if (jsonIndex >= 0 && (!jsonOut || jsonOut.startsWith('--'))) {
    throw new Error('--json requires an output path');
  }
  return {
    verbose: args.includes('--verbose'),
    jsonOut,
    only: args.filter((value, index) => !value.startsWith('--') && index !== jsonIndex + 1),
  };
}

module.exports = {
  auditOutputOptions,
  classifyGetterBody,
  exitCodeForMissingContracts,
  fetchTimeoutMs,
  requiredQueryForGetter,
};
