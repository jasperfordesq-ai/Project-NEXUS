// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { buildNoTokenIndex, noTokenFinding } = require('../scripts/ledger-token-crosscheck');

// 🔴 Why these tests exist rather than trusting the check to be alive.
// The check currently has ZERO subjects in the real ledger, so a live run proves
// nothing about it — it would print the same clean output whether the logic worked
// or had been deleted. These cases are the only evidence it can still fire.
describe('the missing-bearer-token cross-check', () => {
  const ORGANISATIONS = {
    path: '/api/v2/volunteering/my-organisations',
    method: 'GET',
    authMode: 'guest',
    helper: 'getVolunteerOrganisations',
  };

  it('reproduces the /organisations defect: no token sent, API demands one', () => {
    const index = buildNoTokenIndex([ORGANISATIONS]);
    const finding = noTokenFinding(ORGANISATIONS.path, 401, index);
    expect(finding).toContain('getVolunteerOrganisations');
    expect(finding).toContain('WITHOUT a bearer token');
  });

  it('says nothing when the endpoint genuinely serves anonymous callers', () => {
    // A guest helper hitting a public endpoint is correct, not a defect.
    const index = buildNoTokenIndex([{ ...ORGANISATIONS, path: '/api/v2/listings' }]);
    expect(noTokenFinding('/api/v2/listings', 200, index)).toBeNull();
  });

  it('says nothing when the helper does send a token', () => {
    const index = buildNoTokenIndex([{ ...ORGANISATIONS, authMode: 'required' }]);
    expect(noTokenFinding(ORGANISATIONS.path, 401, index)).toBeNull();
  });

  it('treats an optional-bearer helper as fine — it can still authenticate', () => {
    const index = buildNoTokenIndex([{ ...ORGANISATIONS, authMode: 'optional' }]);
    expect(noTokenFinding(ORGANISATIONS.path, 401, index)).toBeNull();
  });

  it('lets the token-less caller win when a path has several callers', () => {
    // The page whose helper omits the token is broken regardless of a sibling that
    // sends one, so the index must not be overwritten into an all-clear.
    const index = buildNoTokenIndex([
      { path: '/api/v2/x', authMode: 'required', helper: 'sendsToken' },
      { path: '/api/v2/x', authMode: 'guest', helper: 'omitsToken' },
    ]);
    expect(noTokenFinding('/api/v2/x', 401, index)).toContain('omitsToken');
  });

  it('survives an empty or malformed ledger without throwing', () => {
    expect(buildNoTokenIndex(undefined).size).toBe(0);
    expect(buildNoTokenIndex([null, {}, { authMode: 'guest' }]).size).toBe(0);
  });

  // 🔴 The honest limit, recorded so nobody reads more into a green run than is there.
  it('cannot see a path the sweep never calls', () => {
    // The sweep only replays PARAMETERLESS GETs. A helper omitting its token on
    // `/api/v2/groups/:id/members` is invisible to this check, and to CI.
    const index = buildNoTokenIndex([
      { path: '/api/v2/groups/:id/members', authMode: 'guest', helper: 'getGroupMembers' },
    ]);
    expect(index.has('/api/v2/groups/:id/members')).toBe(true);
    // ...but nothing ever asks about that path, because it is filtered out upstream.
  });
});
