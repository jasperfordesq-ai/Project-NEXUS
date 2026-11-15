// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * First-time confirmations (warmth phase 6, E8).
 *
 * When a member creates their very first offer or request in a community, the
 * create response carries `meta.celebrate: "first_listing"`
 * (App\Support\FirstTimeCelebration; it rides in `meta`, never in `data`).
 * The React site shows confetti and a line of thanks
 * (components/feedback/CelebrationHost.tsx); here the new listing's page
 * opens with a GOV.UK confirmation panel (partials/first-time-panel.njk).
 *
 * The server also marks a first event (on publishing) and a first group; the
 * accessible site does not show those yet.
 */

function celebrationFrom(result) {
  const meta = result && typeof result === 'object' ? result.meta : null;
  return meta && typeof meta === 'object' && typeof meta.celebrate === 'string' ? meta.celebrate : '';
}

/** The `status` the new listing's page is opened with. */
function listingCreatedStatus(result) {
  return celebrationFrom(result) === 'first_listing' ? 'listing-created-first' : 'listing-created';
}

module.exports = { listingCreatedStatus };
