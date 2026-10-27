// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-224: a pending link can be asked for from EITHER end, so the API tells the
 * viewer whether the answer is theirs (`awaiting_your_response`,
 * SubAccountController). The page showed Approve only on the "people who
 * support me" list, so a supporter asked for help could never accept, and the
 * person who asked was offered a button that the API refuses.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const settingsRoutes = require('../src/routes/settings');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

const t = createTranslator('en');
const shell = {
  t,
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

function row(overrides = {}) {
  return {
    relationship_id: 7,
    user_id: 900015,
    first_name: 'Mary',
    last_name: 'Casey',
    relationship_type: 'carer',
    status: 'pending',
    permissions: {},
    ...overrides
  };
}

function render({ children = [], parents = [] }) {
  const normalize = (rows) => rows.map((r) => settingsRoutes.normalizeRelationship(r, t));
  return env.render('settings/linked-accounts.njk', {
    ...shell,
    children: normalize(children),
    parents: normalize(parents),
    status: '',
    statusMessage: '',
    successStatus: false,
    errorStatus: false,
    maxChildren: 20,
    permissions: [],
    linkTypes: [{ value: 'carer', label: 'Carer' }]
  });
}

const APPROVE = '/settings/linked-accounts/approve';

describe('awaiting_your_response decides who sees Approve', () => {
  it('carries the flag through normalisation', () => {
    expect(settingsRoutes.normalizeRelationship(row({ awaiting_your_response: true }), t).awaitingYourResponse).toBe(true);
    expect(settingsRoutes.normalizeRelationship(row({ awaiting_your_response: false }), t).awaitingYourResponse).toBe(false);
    expect(settingsRoutes.normalizeRelationship(row(), t).awaitingYourResponse).toBeNull();
  });

  it('offers Approve to a supporter whose help was asked for (children list)', () => {
    expect(render({ children: [row({ awaiting_your_response: true })] })).toContain(APPROVE);
  });

  it('does not offer Approve on the supported list when the answer is not theirs', () => {
    expect(render({ parents: [row({ awaiting_your_response: false })] })).not.toContain(APPROVE);
    expect(render({ children: [row({ awaiting_your_response: false })] })).not.toContain(APPROVE);
  });

  it('still offers Approve on the supporters list when the answer is theirs', () => {
    expect(render({ parents: [row({ awaiting_your_response: true })] })).toContain(APPROVE);
  });

  it('falls back to the old rule when the flag is absent', () => {
    expect(render({ parents: [row()] })).toContain(APPROVE);
    expect(render({ children: [row()] })).not.toContain(APPROVE);
  });

  it('never offers Approve on an active link', () => {
    expect(render({ children: [row({ status: 'active', awaiting_your_response: true })] })).not.toContain(APPROVE);
  });
});
