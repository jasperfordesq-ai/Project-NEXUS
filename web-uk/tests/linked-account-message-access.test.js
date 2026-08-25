// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Message access is CONSENT-GATED, and the accessible frontend must show it that
 * way (2026-08-25). Found by walking the linked-accounts page as a carer.
 *
 * What was wrong, all of it on a safeguarding surface:
 *
 *  1. "View their messages" was offered as a permission tick box on the carer's
 *     own card, under a "Save permissions" button, with the supported member
 *     never asked. `can_view_messages` is enforced as NOTHING at any tier —
 *     SubAccountService calls it "the fossil of a switch that saved-and-did-
 *     nothing for years" — so the page told families a carer had a power that
 *     did not exist and could not be granted that way.
 *
 *  2. The real ask / approve / withdraw flow was built in
 *     routes/settings-message-access.js and its copy was translated into all
 *     eleven languages, but nothing on the page linked to it.
 *
 *  3. `supportedMemberName()` read only a composite `name`, which this endpoint
 *     sends as null, so it returned null for every real row — and its only
 *     caller treats null as "not your supported member" and refuses. The
 *     consented viewer was unreachable even with consent granted.
 *
 *  4. The message-access statuses had no entry in SETTINGS_STATUS_MESSAGES, so
 *     asking, withdrawing and being refused all rendered nothing at all.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { supportedMemberName } = require('../src/lib/linked-account-support');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

const shell = {
  t: createTranslator('en'),
  tc: createChoiceTranslator('en'),
  urlFor: (pathname) => pathname,
  formatLocaleNumber: (value) => String(value),
  formatLocaleDate: (value) => String(value ?? ''),
  isAuthenticated: true,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  communityName: 'Acme Timebank',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaLanguageQueryParams: [],
  alphaCurrentLocale: 'en',
  htmlLang: 'en',
  htmlDirection: 'ltr',
  csrfToken: 'test-csrf'
};

function relationship(overrides = {}) {
  return {
    relationshipId: 7,
    userId: 900015,
    name: 'Mary Casey',
    email: 'mary@example.com',
    avatarUrl: null,
    relationshipType: 'carer',
    relationshipTypeLabel: 'Carer',
    status: 'active',
    messageAccess: 'none',
    messageAccessSince: '',
    permissions: { can_view_activity: true, can_manage_listings: false, can_transact: false },
    ...overrides
  };
}

const PERMISSION_CHOICES = [
  { value: 'can_view_activity', field: 'perm_can_view_activity', label: 'View their activity' },
  { value: 'can_manage_listings', field: 'perm_can_manage_listings', label: 'Manage their listings' },
  { value: 'can_transact', field: 'perm_can_transact', label: 'Send and receive time credits' }
];

function renderLinked({ children = [], parents = [], status = '' } = {}) {
  return env.render('settings/linked-accounts.njk', {
    ...shell,
    children,
    parents,
    status,
    statusMessage: '',
    successStatus: false,
    errorStatus: false,
    maxChildren: 20,
    permissions: PERMISSION_CHOICES,
    linkTypes: [{ value: 'carer', label: 'Carer' }]
  });
}

function visibleText(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(html);
  return (main ? main[0] : html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the dead can_view_messages switch is gone', () => {
  it('offers no message tick box on a supported member card', () => {
    const html = renderLinked({ children: [relationship()] });

    expect(html).not.toContain('perm_can_view_messages');
    // The label text must not appear inside the permissions fieldset either.
    const fieldset = /<fieldset[\s\S]*?<\/fieldset>/.exec(html);
    expect(fieldset && fieldset[0]).not.toMatch(/View their messages/);
  });

  it('offers no message tick box on the new-link form', () => {
    const html = renderLinked();

    expect(html).not.toContain('perm_can_view_messages');
  });
});

describe('the supporter sees the real ask-and-approve flow', () => {
  it('offers to ASK, and says whose yes it needs, when access is none', () => {
    const html = renderLinked({ children: [relationship({ messageAccess: 'none' })] });
    const text = visibleText(html);

    expect(html).toContain('/settings/linked-accounts/message-access/request');
    expect(text).toContain('Ask to view their messages');
    // The explainer must name the member and state the three guarantees.
    expect(text).toContain("Viewing only ever starts with Mary Casey's own yes");
  });

  it('offers no button while an ask is already open, because asking again is a no-op', () => {
    const html = renderLinked({ children: [relationship({ messageAccess: 'pending' })] });

    expect(html).not.toContain('/settings/linked-accounts/message-access/request');
    expect(visibleText(html)).toContain('Waiting for Mary Casey to approve');
  });

  it('links to the read-only viewer, by USER id, once access is active', () => {
    const html = renderLinked({
      children: [relationship({ messageAccess: 'active', messageAccessSince: '25 August 2026' })]
    });
    const text = visibleText(html);

    // 🔴 The viewer is keyed by the supported member's user id; the consent
    // writes are keyed by the relationship id. Mixing them shows another person.
    expect(html).toContain('href="/settings/linked-accounts/messages/900015"');
    expect(html).not.toContain('href="/settings/linked-accounts/messages/7"');
    expect(text).toContain('You have been able to view since 25 August 2026.');
  });
});

describe('the supported member keeps control', () => {
  it('is told plainly who can read their messages, and can stop it in one press', () => {
    const html = renderLinked({ parents: [relationship({ messageAccess: 'active' })] });
    const text = visibleText(html);

    expect(text).toContain('Mary Casey can view your messages');
    expect(html).toContain('/settings/linked-accounts/message-access/withdraw');
    expect(text).toContain('Stop them viewing my messages');
  });

  it('is never shown a withdraw button when nobody has access', () => {
    const html = renderLinked({ parents: [relationship({ messageAccess: 'none' })] });

    expect(html).not.toContain('/settings/linked-accounts/message-access/withdraw');
    // And not a bare heading with nothing under it either.
    expect(visibleText(html)).not.toContain('Their messages');
  });

  it('cannot ask on their own behalf — asking is the supporter\'s move', () => {
    const html = renderLinked({ parents: [relationship({ messageAccess: 'none' })] });

    expect(html).not.toContain('/settings/linked-accounts/message-access/request');
  });

  it('is pointed at where the decision is actually made while an ask is open', () => {
    const html = renderLinked({ parents: [relationship({ messageAccess: 'pending' })] });

    expect(html).toContain('href="/settings/support-actions"');
  });
});

describe('a supported member is found by the name the API actually sends', () => {
  const rows = [
    { user_id: 900015, first_name: 'Mary', last_name: 'Casey', name: null, email: 'mary@example.com' }
  ];
  const getChildAccounts = async () => ({ data: rows });

  it('composes the name from first and last when there is no composite name', async () => {
    // 🔴 This returned null for every real row, and the only caller reads null
    // as "not your supported member" and refuses the viewer outright.
    await expect(supportedMemberName(getChildAccounts, 't', 900015)).resolves.toBe('Mary Casey');
  });

  it('still prefers a composite name when the API sends one', async () => {
    const withName = async () => ({ data: [{ user_id: 1, name: 'Bantry Repair Cafe' }] });

    await expect(supportedMemberName(withName, 't', 1)).resolves.toBe('Bantry Repair Cafe');
  });

  it('falls back to the email rather than refusing a real relationship', async () => {
    const nameless = async () => ({ data: [{ user_id: 2, email: 'someone@example.com' }] });

    await expect(supportedMemberName(nameless, 't', 2)).resolves.toBe('someone@example.com');
  });

  it('still returns null for somebody who is not a supported member', async () => {
    await expect(supportedMemberName(getChildAccounts, 't', 999999)).resolves.toBeNull();
  });
});
