// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Whether the signed-in member may create Events in this community.
 *
 * A community can restrict Event creation to brokers and administrators, or to
 * administrators only. GET /api/v2/users/me reports the answer as
 * `can_create_events`, resolved by the same server predicate POST /api/v2/events
 * enforces (React 7565bee36). The server still refuses regardless; this only
 * stops offering a form the member cannot submit.
 *
 * 🔴 ABSENT means ALLOWED, exactly as in React's `canCreateEvents()`: the field
 * is omitted when the server could not work it out, and only an explicit
 * `false` hides anything. A failed profile read therefore keeps the button.
 */

const { getRequestProfile } = require('./request-profile');
const { ApiError } = require('./api');

function profileFrom(result) {
  const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  if (data.user && typeof data.user === 'object') return data.user;
  return data;
}

function canCreateEventsFromProfile(result) {
  return profileFrom(result).can_create_events !== false;
}

async function resolveCanCreateEvents(req, token = req?.token) {
  if (!token) return false;
  try {
    return canCreateEventsFromProfile(await getRequestProfile(req, token));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return true;
  }
}

module.exports = { canCreateEventsFromProfile, resolveCanCreateEvents };
