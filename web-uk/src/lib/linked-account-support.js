// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared helpers for the linked-account surfaces that sit beside the settings
 * hub page. Kept in one place so the activity summary and the message-access
 * consent loop cannot drift apart in how they identify a supported member or
 * how they report a refusal.
 */

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function linkedAccountsRedirect(res, status, fragment) {
  const base = `${res.locals.urlFor('/settings/linked-accounts')}?status=${encodeURIComponent(status)}`;
  return res.redirect(fragment ? `${base}#${fragment}` : base);
}

/**
 * Resolve a supported member's display name from THIS user's own children list.
 *
 * A member id belonging to somebody else therefore never yields a name, which
 * is the first of two independent gates — the backing service re-checks the
 * grant on every request regardless. The list shape is read defensively because
 * the envelope differs between endpoints.
 */
async function supportedMemberName(getChildAccounts, token, childUserId) {
  const data = unwrap(await getChildAccounts(token));
  const children = Array.isArray(data.children)
    ? data.children
    : (Array.isArray(data.sub_accounts) ? data.sub_accounts : (Array.isArray(data) ? data : []));

  for (const child of children) {
    const id = positiveInt(child?.user_id ?? child?.child_user_id ?? child?.id);
    if (id === childUserId) {
      // 🔴 Compose from first/last as well. `GET /users/me/sub-accounts` returns
      // `first_name` and `last_name` and NO composite `name`, so this returned
      // null for every real row — and the only caller treats null as "not your
      // supported member" and refuses the viewer. The consented message view was
      // therefore unreachable even with consent properly granted.
      const composed = [child?.first_name, child?.last_name]
        .map((part) => String(part ?? '').trim())
        .filter(Boolean)
        .join(' ');
      return String(child?.name ?? '').trim()
        || String(child?.child_name ?? '').trim()
        || composed
        || String(child?.email ?? '').trim()
        || null;
    }
  }

  return null;
}

module.exports = {
  linkedAccountsRedirect,
  positiveInt,
  supportedMemberName,
  unwrap
};
