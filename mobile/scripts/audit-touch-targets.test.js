// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const {
  auditExitCode,
  isKeyguardShowing,
  summariseResults,
} = require('./audit-touch-targets-lib.cjs');

const source = fs.readFileSync(path.join(__dirname, 'audit-touch-targets.mjs'), 'utf8');

describe('touch-target audit route isolation', () => {
  it('force-stops the app immediately before every deep-link probe', () => {
    expect(source).toMatch(/for \(const route of screens\)[\s\S]*?forceStopApp\(\);\s*openScreen\(route\);/);
  });

  it('opens the package-owned nexus scheme instead of handing an https link to Android', () => {
    expect(source).toContain("const BASE_URL = 'nexus://';");
    expect(source).toMatch(/'am', 'start', '-W',[\s\S]*?'-d', `\$\{BASE_URL\}\$\{route\}`,[\s\S]*?'-p', PACKAGE/);
  });

  it('fingerprint-gates the widened member-facing screen set', () => {
    for (const route of [
      'connections', 'activity', 'endorsements', 'reviews', 'skills',
      'courses', 'podcasts', 'clubs', 'venues', 'ideation',
    ]) {
      expect(source).toContain(`'${route}'`);
      expect(source).toMatch(new RegExp(`\\b${route.replace('-', "['-]")}\\s*:`));
    }
  });

  it('does not settle on a stable native splash before the routed screen arrives', () => {
    expect(source).toContain('async function settledTree(previousSignature, fingerprint)');
    expect(source).toMatch(/if \(fingerprint && !fingerprint\.test\(xml\)\) continue;/);
  });

  it('can audit the public login and community-picker screens without a member session', () => {
    expect(source).toMatch(/login:\s*\/Welcome back\|Sign in to your timebank\//);
    expect(source).toMatch(/'select-tenant':\s*\/Select your timebank\|Choose the community you belong to\//);
  });

  it('reports scroll-viewport clipping separately from genuine undersized targets', () => {
    expect(source).toContain('function isClippedAtScrollableEdge(node, nodes)');
    expect(source).toContain('viewportClipped: clipped.length');
    expect(source).toContain('not counted as target-size failures');
  });

  it('does not count disabled decorative Pressables or invalid off-viewport bounds as targets', () => {
    expect(source).toContain('if (x2 <= x1 || y2 <= y1) continue;');
    expect(source).toMatch(/nodes\.filter\(\(node\) => node\.enabled && \(node\.clickable \|\| node\.longClickable\)\)/);
  });
});

describe('touch-target audit result integrity', () => {
  it('recognises both window-policy keyguard states used by Android emulators', () => {
    expect(isKeyguardShowing('showing=true\n    mIsShowing=true')).toBe(true);
    expect(isKeyguardShowing('showing=false\n    mIsShowing=false')).toBe(false);
  });

  it('does not report a successful audit when no requested screen was verified', () => {
    const summary = summariseResults([
      { route: 'home', status: 'unverified' },
      { route: 'wallet', status: 'unreadable' },
    ]);

    expect(summary).toEqual({
      requested: 2,
      verified: 0,
      unverified: 1,
      unreadable: 1,
      unsettled: 0,
    });
    expect(auditExitCode({ summary, belowAA: 0 })).toBe(2);
  });

  it('fails an incomplete audit even when some screens passed', () => {
    const summary = summariseResults([
      { route: 'settings', status: 'verified' },
      { route: 'support', status: 'unverified' },
    ]);

    expect(auditExitCode({ summary, belowAA: 0 })).toBe(2);
  });

  it('uses the accessibility failure exit code only for a complete audit', () => {
    const summary = summariseResults([
      { route: 'settings', status: 'verified' },
      { route: 'support', status: 'verified' },
    ]);

    expect(auditExitCode({ summary, belowAA: 1 })).toBe(1);
    expect(auditExitCode({ summary, belowAA: 0 })).toBe(0);
  });
});
