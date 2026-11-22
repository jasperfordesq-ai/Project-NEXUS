// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { staysOpenDuringMaintenance, staysOpenWhilePaused } from './maintenanceBypass';

describe('staysOpenDuringMaintenance', () => {
  it('keeps the admin panel open, with or without a community slug', () => {
    expect(staysOpenDuringMaintenance('/admin')).toBe(true);
    expect(staysOpenDuringMaintenance('/admin/settings')).toBe(true);
    expect(staysOpenDuringMaintenance('/test/admin', 'test')).toBe(true);
    expect(staysOpenDuringMaintenance('/test/admin/settings', 'test')).toBe(true);
  });

  // The Platform team panel holds the health pages. A community in maintenance
  // is exactly when the platform team needs them; each page still has its own
  // guard, so keeping the address open lets nobody else in.
  it('keeps the Platform team panel open, with or without a community slug', () => {
    expect(staysOpenDuringMaintenance('/platform-team')).toBe(true);
    expect(staysOpenDuringMaintenance('/platform-team/cron-jobs')).toBe(true);
    expect(staysOpenDuringMaintenance('/test/platform-team', 'test')).toBe(true);
    expect(staysOpenDuringMaintenance('/test/platform-team/enterprise/monitoring', 'test')).toBe(true);
  });

  it('ignores the case of the address', () => {
    expect(staysOpenDuringMaintenance('/Admin/Settings')).toBe(true);
    expect(staysOpenDuringMaintenance('/Test/Platform-Team', 'test')).toBe(true);
  });

  it('does not keep member pages open', () => {
    expect(staysOpenDuringMaintenance('/dashboard')).toBe(false);
    expect(staysOpenDuringMaintenance('/test/feed', 'test')).toBe(false);
    expect(staysOpenDuringMaintenance('/')).toBe(false);
  });

  it('does not match an address that only starts with the same letters', () => {
    expect(staysOpenDuringMaintenance('/administrator')).toBe(false);
    expect(staysOpenDuringMaintenance('/platform-team-news')).toBe(false);
    expect(staysOpenDuringMaintenance('/platform/terms')).toBe(false);
    expect(staysOpenDuringMaintenance('/test/admins', 'test')).toBe(false);
  });

  it('does not treat a panel name in the wrong place as the panel', () => {
    expect(staysOpenDuringMaintenance('/other/admin', 'test')).toBe(false);
    expect(staysOpenDuringMaintenance('/blog/platform-team')).toBe(false);
  });
});

describe('staysOpenWhilePaused', () => {
  it('keeps the admin, Platform team and super admin panels open, with or without a community prefix', () => {
    for (const path of ['/admin', '/admin/billing', '/platform-team', '/super-admin', '/super-admin/branch-payments', '/super-admin/branch-plans']) {
      expect(staysOpenWhilePaused(path)).toBe(true);
      expect(staysOpenWhilePaused(`/riverside${path}`, 'riverside')).toBe(true);
    }
  });

  it('does not keep the member side or the broker panel open', () => {
    for (const path of ['/', '/dashboard', '/broker', '/broker/members', '/super-administrator', '/administer']) {
      expect(staysOpenWhilePaused(path)).toBe(false);
    }
  });

  // A person must always be able to stop emails. The link in a newsletter
  // opens this page, which was hidden behind the paused page.
  it('keeps the newsletter unsubscribe page open, with or without a community prefix', () => {
    expect(staysOpenWhilePaused('/newsletter/unsubscribe')).toBe(true);
    expect(staysOpenWhilePaused('/newsletter/unsubscribe/')).toBe(true);
    expect(staysOpenWhilePaused('/Newsletter/Unsubscribe')).toBe(true);
    expect(staysOpenWhilePaused('/riverside/newsletter/unsubscribe', 'riverside')).toBe(true);
  });

  it('opens that one page only, not the pages beside or below it', () => {
    for (const path of ['/newsletter', '/newsletter/archive', '/newsletter/unsubscribed', '/newsletter/unsubscribe/more', '/blog/newsletter/unsubscribe']) {
      expect(staysOpenWhilePaused(path)).toBe(false);
    }
    expect(staysOpenWhilePaused('/other/newsletter/unsubscribe', 'riverside')).toBe(false);
  });

  it('does not open the unsubscribe page during maintenance: that list is unchanged', () => {
    expect(staysOpenDuringMaintenance('/newsletter/unsubscribe')).toBe(false);
  });

  it('leaves the maintenance list as it was: the super admin panel is not on it', () => {
    expect(staysOpenDuringMaintenance('/super-admin')).toBe(false);
    expect(staysOpenDuringMaintenance('/admin')).toBe(true);
  });
});
