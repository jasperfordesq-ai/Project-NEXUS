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

module.exports = { exitCodeForMissingContracts, requiredQueryForGetter };
