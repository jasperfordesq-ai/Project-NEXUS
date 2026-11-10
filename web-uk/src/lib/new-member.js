// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * "New here": a member who joined in the last 30 days — the same rule as the
 * React members directory (react-frontend/src/pages/members/MembersPage.tsx,
 * isNewMember), so both sites welcome the same people (AWID feedback, Nov 2026:
 * "warmth, and community"). It reads only the join date the directory already
 * sends, so it shows nothing a member could not already see.
 */

const NEW_MEMBER_DAYS = 30;
const DAY_MS = 86400000;

function isNewMember(createdAt, now = Date.now()) {
  if (typeof createdAt !== 'string' || !createdAt.trim()) return false;
  // The directory sends "YYYY-MM-DD HH:MM:SS".
  const text = createdAt.trim();
  const joined = new Date(text.includes('T') ? text : text.replace(' ', 'T')).getTime();
  if (Number.isNaN(joined)) return false;
  const age = now - joined;
  return age >= 0 && age < NEW_MEMBER_DAYS * DAY_MS;
}

module.exports = { NEW_MEMBER_DAYS, isNewMember };
