// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Is message translation offered in this community?
 *
 * Two switches, both from the tenant bootstrap: the `message_translation`
 * feature, and Admin → Translation settings "Enable translation"
 * (`translation.enabled`, published since 30 Oct 2026; absent from older
 * bootstraps, which means on). The API refuses when either is off, so the
 * site must not offer a button that can only fail.
 */

const { flagEnabled } = require('./accessible-shell');

function translationAvailable(req) {
  const tenant = req && req.accessibleRouting && req.accessibleRouting.tenant;
  if (!tenant || typeof tenant !== 'object') return true;
  if (!flagEnabled(tenant, 'message_translation', 'features', true)) return false;
  return !(tenant.translation && tenant.translation.enabled === false);
}

module.exports = { translationAvailable };
