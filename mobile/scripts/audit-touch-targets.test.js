// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const {
  auditExitCode,
  isKeyguardShowing,
  structuralSignature,
  summariseResults,
} = require('./audit-touch-targets-lib.cjs');

const source = fs.readFileSync(path.join(__dirname, 'audit-touch-targets.mjs'), 'utf8');

describe('touch-target audit route isolation', () => {
  it('settles on accessibility structure rather than dynamic labels', () => {
    const first = '<node text="3 minutes ago" content-desc="Post by Alice" resource-id="post" class="android.view.View" clickable="true" enabled="true" bounds="[0,0][100,100]" />';
    const second = '<node text="4 minutes ago" content-desc="Post by Bob" resource-id="post" class="android.view.View" clickable="true" enabled="true" bounds="[0,0][100,100]" />';
    expect(structuralSignature(first)).toBe(structuralSignature(second));
  });

  it('ignores transient geometry but detects the actionable set changing', () => {
    const base = '<hierarchy>'
      + '<node class="android.widget.TextView" text="1 minute ago" bounds="[20,20][140,50]" />'
      + '<node resource-id="save-action" class="android.view.View" clickable="true" '
      + 'long-clickable="false" enabled="true" scrollable="false" bounds="[20,60][140,180]" />'
      + '</hierarchy>';
    const decorativeResize = base.replace('[20,20][140,50]', '[20,20][220,50]');
    const targetMove = base.replace('[20,60][140,180]', '[30,60][150,180]');
    const targetRemoved = base.replace(/<node resource-id="save-action"[^>]+\/>/, '');

    expect(structuralSignature(base)).toBe(structuralSignature(decorativeResize));
    expect(structuralSignature(base)).toBe(structuralSignature(targetMove));
    expect(structuralSignature(base)).not.toBe(structuralSignature(targetRemoved));
  });

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
      'gamification', 'nexus-score', 'federation',
    ]) {
      expect(source).toContain(`'${route}'`);
      expect(source).toContain(route.includes('-') ? `'${route}':` : `${route}:`);
    }
  });

  it('does not settle on a stable native splash before the routed screen arrives', () => {
    expect(source).toContain('async function settledTree(previousSignature, fingerprint)');
    expect(source).toMatch(/if \(fingerprint && !fingerprint\.test\(xml\)\) continue;/);
  });

  it('tolerates one transient UIAutomator subtree omission without accepting one sample', () => {
    expect(source).toContain('const seenSignatures = new Map()');
    expect(source).toMatch(/const seen = \(seenSignatures\.get\(signature\) \?\? 0\) \+ 1;[\s\S]*?if \(seen >= 2\)/);
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
