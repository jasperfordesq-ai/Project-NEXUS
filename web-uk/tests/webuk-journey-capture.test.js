// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Why this file exists.
 *
 * `scripts/capture-webuk-journey-screenshots.js` writes images into
 * `docs/screenshots/journey/`, and those images are COMMITTED TO A PUBLIC
 * REPOSITORY. Two guards are the only thing stopping a run against the shared local
 * `nexus` database — a confidential production-derived snapshot — putting real
 * members' names, listings and messages into that public history.
 *
 * Until 2026-08-14 the script had no test at all. It gained one when the two
 * Blade-pairing capture suites (`tests/blade-visual-spotcheck.test.js`,
 * `tests/visual-screenshot-capture.test.js`) were deleted along with the scripts
 * they covered: those suites asserted the equivalent refusal properties for the old
 * paired capture, and dropping them without replacing that coverage would have left
 * the surviving script's safety guards entirely untested.
 */

const {
  assertSyntheticMemberVisible,
  assertDisposableDatabase,
  urlFor,
  PAGES,
  VIEWPORTS,
  ACCOUNT,
  DB_NAME,
} = require('../scripts/capture-webuk-journey-screenshots');

describe('web-uk journey screenshot capture guards', () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = () => {};
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('targets the disposable fixture database, never the shared local one', () => {
    // The shared `nexus` database is production-derived. A capture run must not be
    // able to reach it by default, whatever else changes in this script.
    expect(DB_NAME).toBe('nexus_webuk_e2e');
    expect(DB_NAME).not.toBe('nexus');
  });

  it('refuses when the signed-in page does not show the synthetic member', () => {
    // This is the second guard's whole purpose: proof that the sign-in landed on the
    // fixture account, not merely that a page rendered. A page that redirected to
    // login still has a heading and a main landmark.
    expect(() => assertSyntheticMemberVisible('<html><h1>Sign in</h1></html>'))
      .toThrow(/REFUSING TO CAPTURE/);
  });

  it('accepts a page that shows the synthetic member', () => {
    expect(() => assertSyntheticMemberVisible(`<p>Signed in as ${ACCOUNT.expectedName}</p>`))
      .not.toThrow();
  });

  // 🔴 The query is injected in all four cases below. An earlier version of this test
  // called the guard with its real docker-backed query, which meant it passed for one
  // reason when the disposable environment happened to be running and a completely
  // different reason when it was not. Same green tick, no idea which path ran.
  const stubQuery = (total, real) => (sql) => (
    sql.includes('NOT LIKE') ? String(real) : String(total)
  );

  it('refuses when even one account does not look synthetic', () => {
    // The case that matters: capturing from the shared production-derived database and
    // committing real members' names into a public repository.
    expect(() => assertDisposableDatabase(stubQuery(370, 369)))
      .toThrow(/REFUSING TO CAPTURE: 369 of 370 accounts/);
  });

  it('refuses an unseeded database rather than capturing empty pages', () => {
    expect(() => assertDisposableDatabase(stubQuery(0, 0)))
      .toThrow(/has no users/);
  });

  it('fails closed when the database cannot be inspected at all', () => {
    // An unreachable database must never be read as "probably fine" — the guard exists
    // precisely for the case where the environment is not what the operator assumes.
    const throwingQuery = () => { throw new Error('container not running'); };
    expect(() => assertDisposableDatabase(throwingQuery))
      .toThrow(/Could not inspect nexus_webuk_e2e/);
  });

  it('accepts a database of entirely synthetic accounts', () => {
    expect(() => assertDisposableDatabase(stubQuery(11, 0))).not.toThrow();
  });

  it('builds URLs on the community accessible mount, never the legacy alpha mount', () => {
    const url = urlFor('/dashboard');
    expect(url).toContain('/accessible/dashboard');
    expect(url).not.toContain('/alpha/');
  });

  it('keeps the captured set small and includes the 320px reflow width', () => {
    // Every page is two committed images. A set nobody reviews is repository weight,
    // so this asserts the deliberate bound rather than just "some pages exist".
    expect(PAGES.length).toBeGreaterThan(0);
    expect(PAGES.length).toBeLessThanOrEqual(12);
    // WCAG 2.2 §1.4.10 reflow is measured at 320 CSS pixels; capturing it is what
    // makes a horizontal-scroll regression visible rather than merely measurable.
    expect(VIEWPORTS.map((v) => v.width)).toContain(320);
  });
});
