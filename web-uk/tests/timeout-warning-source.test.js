// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

describe('session timeout source contract', () => {
  const timeoutSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'timeout-warning.js'),
    'utf8'
  );
  const baseTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'views', 'layouts', 'base.njk'),
    'utf8'
  );

  it('signs out through the CSRF-protected POST form instead of a GET navigation', () => {
    expect(timeoutSource).toContain('form="session-timeout-logout-form"');
    expect(timeoutSource).toContain('submitLogout();');
    expect(timeoutSource).not.toMatch(/href=["']\/logout/);
    expect(timeoutSource).not.toMatch(/window\.location\.href\s*=\s*["']\/logout/);

    expect(baseTemplate).toContain('id="session-timeout-logout-form"');
    expect(baseTemplate).toContain('method="post" action="{{ urlFor(\'/logout\') }}"');
    expect(baseTemplate).toContain('name="_csrf" value="{{ csrfToken }}"');
  });

  it('counts down the full warning lead so logout lands at the session timeout, not early', () => {
    // Regression guard: a fixed COUNTDOWN_SECONDS (e.g. 60) while the warning
    // appears WARNING_BEFORE_MINUTES early logs idle members out that many
    // minutes before their session actually expires. The countdown must equal
    // the warning lead.
    expect(timeoutSource).toMatch(/COUNTDOWN_SECONDS\s*=\s*WARNING_BEFORE_MINUTES\s*\*\s*60/);
    expect(timeoutSource).not.toMatch(/COUNTDOWN_SECONDS\s*=\s*60\s*;/);
    // A single shared formatter feeds both the initial notice and the live
    // countdown, so they cannot disagree about the time remaining.
    expect(timeoutSource).toContain('formatCountdownText(COUNTDOWN_SECONDS)');
    expect(timeoutSource).toContain('formatCountdownText(countdownSeconds)');
    // submitLogout is guarded so the countdown end and the backup timer (now
    // coincident at the real timeout) cannot double-submit.
    expect(timeoutSource).toMatch(/if\s*\(loggingOut\)\s*\{/);
  });

  it('uses the tenant-aware rendered login URL when session extension fails', () => {
    expect(baseTemplate).toContain('id="session-timeout-login-link" href="{{ urlFor(\'/login\') }}"');
    expect(timeoutSource).toContain("getElementById('session-timeout-login-link')");
    expect(timeoutSource).toContain('loginLink.click();');
    expect(timeoutSource).not.toContain("getAttribute('data-login-url')");
  });
});
