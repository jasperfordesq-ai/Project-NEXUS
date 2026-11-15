// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { staysOpenDuringMaintenance } from './maintenanceBypass';

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
