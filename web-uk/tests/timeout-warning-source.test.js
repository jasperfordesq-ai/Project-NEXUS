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

  /**
   * 🔴 Browsers throttle and batch setTimeout/setInterval in background tabs
   * (and suspend them during OS sleep). The original implementation carried the
   * schedule IN the timers ("warn in 25 minutes"), so a backgrounded tab warned
   * minutes late — usually the moment the member re-activated the tab, and
   * sometimes not at all. Because this script is also what signs an idle member
   * out, that left unattended signed-in tabs signed in indefinitely.
   */
  it('schedules against a wall-clock deadline, not timer durations', () => {
    // The deadline is absolute (epoch ms) and checked against Date.now().
    expect(timeoutSource).toMatch(/deadlineAt\s*=\s*Date\.now\(\)\s*\+\s*sessionTimeoutMs/);
    expect(timeoutSource).toMatch(/now\s*>=\s*deadlineAt/);
    // No timer carries the warning or logout schedule.
    expect(timeoutSource).not.toMatch(/setTimeout\(\s*showModal/);
    expect(timeoutSource).not.toMatch(/setTimeout\(\s*submitLogout/);
    expect(timeoutSource).not.toContain('warningTimer');
    expect(timeoutSource).not.toContain('logoutTimer');
    // The displayed countdown derives from the deadline rather than
    // decrementing a counter, so a throttled tab cannot display more time than
    // truly remains.
    expect(timeoutSource).toMatch(/countdownSeconds\s*=\s*remainingSeconds\(\)/);
    expect(timeoutSource).not.toMatch(/countdownSeconds--/);
  });

  it('reconciles immediately when a tab is re-activated or restored', () => {
    // visibilitychange covers tab switches, focus covers window switches, and
    // pageshow covers back/forward-cache restores where no load event fires.
    expect(timeoutSource).toContain("addEventListener('visibilitychange'");
    expect(timeoutSource).toMatch(/addEventListener\('focus',\s*check\)/);
    expect(timeoutSource).toContain("addEventListener('pageshow'");
  });

  it('keeps sibling tabs in step and rolls the server window with activity', () => {
    // Activity in one tab extends every tab sharing the session.
    expect(timeoutSource).toContain('nexusWebukSessionActivityAt');
    expect(timeoutSource).toContain("addEventListener('storage'");
    // Local activity pings /session/touch (throttled) so the SERVER session
    // rolls too — scrolling and typing never reach the server on their own.
    expect(timeoutSource).toContain('KEEP_ALIVE_INTERVAL_MS');
    // While the modal is open the member must choose explicitly; background
    // activity must not extend the session.
    expect(timeoutSource).toMatch(/if\s*\(!modalOpen\s*&&\s*!loggingOut\)/);
  });
});
