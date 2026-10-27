// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Who may open a group's gallery, challenges, chat channels and webhooks, and
 * whether the community has switched each one on (parity work, 27 Oct 2026).
 *
 * The rules are the website's, copied rather than reinvented:
 *
 * - react-frontend/src/pages/groups/groupSections.ts: `media`, `challenges` and
 *   `chatrooms` each have a `tab_<key>` setting and need an active member or a
 *   group admin; `automation` (where the website keeps its webhook panel) has no
 *   setting and needs a group admin;
 * - a `tab_<key>` setting counts as ON unless the community's
 *   `group_tabs.tab_<key>` is false (`hasGroupTab(tab) => groupTabs[tab] ?? true`
 *   in TenantContext.tsx). The settings arrive with the tenant bootstrap;
 * - GroupTabContent.tsx renders the chat channels only for a member (an admin
 *   who is not a member sees "members only"), and TeamChatrooms.tsx treats a
 *   group admin OR a community administrator role as the channel admin;
 * - "member" is `viewer_membership.status === 'active'` (else `is_member`), and
 *   "admin" is `viewer_membership.is_admin` (else `is_admin`)
 *   (GroupDetailPage.tsx isMember / isGroupAdmin).
 *
 * Channels additionally need the community's `ideation_challenges` feature: the
 * API refuses every chatroom call without it (IdeationChallengesController::
 * ensureFeature), so showing the section would only lead to an error page.
 *
 * A section the community switched off answers 404, as if it did not exist; a
 * person without the right standing gets 403. The API applies the same gates
 * (`group.tab:<key>` middleware and its own permission checks), so this is the
 * page agreeing with the server, not the only lock.
 */

const { getGroup } = require('./api');
const { getRequestProfile } = require('./request-profile');
const { flagEnabled } = require('./accessible-shell');

const SECTION_RULES = Object.freeze({
  media: { configKey: 'tab_media', requiresMembership: true },
  challenges: { configKey: 'tab_challenges', requiresMembership: true },
  chatrooms: { configKey: 'tab_chatrooms', requiresActiveMember: true, feature: 'ideation_challenges' },
  automation: { requiresAdmin: true }
});

const CHANNEL_ADMIN_ROLES = new Set(['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin']);

function isOff(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function text(value) {
  return String(value ?? '').trim();
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function groupTabs(tenant) {
  const tabs = tenant && typeof tenant === 'object' ? tenant.group_tabs : null;
  return tabs && typeof tabs === 'object' && !Array.isArray(tabs) ? tabs : {};
}

/** Whether the community has this section switched on (membership aside). */
function sectionSwitchedOn(tenant, section) {
  const rule = SECTION_RULES[section];
  if (!rule) return false;
  if (rule.configKey && isOff(groupTabs(tenant)[rule.configKey])) return false;
  if (rule.feature && !flagEnabled(tenant && typeof tenant === 'object' ? tenant : {}, rule.feature, 'features')) {
    return false;
  }
  return true;
}

function legacyMembership(raw) {
  return raw.my_membership || raw.myMembership || raw.membership || null;
}

function isMember(raw) {
  if (raw.viewer_membership && typeof raw.viewer_membership === 'object') {
    return text(raw.viewer_membership.status) === 'active';
  }
  const legacy = legacyMembership(raw);
  if (legacy && typeof legacy === 'object') {
    const status = text(legacy.status || legacy.state);
    if (status !== '') return status === 'active';
    return ['member', 'admin', 'owner'].includes(text(legacy.role));
  }
  if (raw.my_status !== undefined && raw.my_status !== null) return text(raw.my_status) === 'active';
  return truthy(raw.is_member);
}

function isAdmin(raw) {
  if (raw.viewer_membership && typeof raw.viewer_membership === 'object') {
    return truthy(raw.viewer_membership.is_admin);
  }
  if (raw.is_admin !== undefined) return truthy(raw.is_admin);
  const legacy = legacyMembership(raw);
  const role = text(legacy?.role || raw.my_role);
  const status = text(legacy?.status || legacy?.state || raw.my_status);
  return ['admin', 'owner'].includes(role) && (status === '' || status === 'active');
}

function profileFrom(result) {
  const data = dataFrom(result) || {};
  if (data.user && typeof data.user === 'object') return data.user;
  return data && typeof data === 'object' ? data : {};
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Load the group and decide whether this person may open `section`.
 *
 * @returns {Promise<{ allowed: true, group, isMember, isAdmin, isChannelAdmin, viewerId } |
 *                   { allowed: false, status: 403|404 }>}
 */
async function groupSectionAccess(req, id, section) {
  const rule = SECTION_RULES[section];
  if (!rule || !sectionSwitchedOn(req.accessibleRouting?.tenant, section)) {
    return { allowed: false, status: 404 };
  }

  const groupResult = await getGroup(req.token, id);
  const data = dataFrom(groupResult);
  const raw = (data && typeof data === 'object' && data.group && typeof data.group === 'object')
    ? data.group
    : (data && typeof data === 'object' ? data : {});
  const member = isMember(raw);
  const admin = isAdmin(raw);

  if (rule.requiresAdmin && !admin) return { allowed: false, status: 403 };
  if (rule.requiresMembership && !member && !admin) return { allowed: false, status: 403 };
  if (rule.requiresActiveMember && !member) return { allowed: false, status: 403 };

  const profile = profileFrom(await getRequestProfile(req, req.token).catch(() => null));
  const role = text(profile.role);

  return {
    allowed: true,
    group: {
      id: positiveInteger(raw.id) || Number(id),
      name: text(raw.name || raw.title) || 'Group'
    },
    isMember: member,
    isAdmin: admin,
    isChannelAdmin: admin || CHANNEL_ADMIN_ROLES.has(role),
    viewerId: positiveInteger(profile.id || profile.user_id)
  };
}

function renderRefusal(res, status) {
  const t = typeof res.locals?.t === 'function' ? res.locals.t : null;
  if (status === 404) {
    return res.status(404).render('errors/404', { title: t ? t('govuk_alpha.error_pages.404_title') : 'Page not found' });
  }
  return res.status(403).render('errors/403', { title: t ? t('govuk_alpha.error_pages.403_title') : 'Forbidden' });
}

/**
 * Route guard: resolves the access context, or answers the refusal itself and
 * returns null.
 */
async function requireGroupSection(req, res, section) {
  const access = await groupSectionAccess(req, req.params.id, section);
  if (!access.allowed) {
    renderRefusal(res, access.status);
    return null;
  }
  return access;
}

module.exports = {
  SECTION_RULES,
  sectionSwitchedOn,
  groupSectionAccess,
  requireGroupSection,
  renderRefusal,
  isMember,
  isAdmin
};
