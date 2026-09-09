// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { communityRepairStore } from './communityRepairStore';

describe('knowing whether the app is already fixing its community', () => {
  beforeEach(() => {
    communityRepairStore.__resetForTests();
  });

  it('is quiet until something starts', () => {
    expect(communityRepairStore.isRepairing()).toBe(false);
  });

  it('reports a repair from the moment it starts until it finishes', () => {
    const finish = communityRepairStore.begin();
    expect(communityRepairStore.isRepairing()).toBe(true);

    finish();
    expect(communityRepairStore.isRepairing()).toBe(false);
  });

  /**
   * 🔴 Counted, not a boolean. The launch check and a sign-in can overlap, and with a plain
   * flag whichever finished first would declare the other finished too — reopening the
   * community picker on top of a repair that was still running.
   */
  it('stays raised until the last overlapping repair is done', () => {
    const first = communityRepairStore.begin();
    const second = communityRepairStore.begin();

    first();
    expect(communityRepairStore.isRepairing()).toBe(true);

    second();
    expect(communityRepairStore.isRepairing()).toBe(false);
  });

  /**
   * 🔴 A repair that finishes twice — a `finally` plus a caller being careful — must not
   * cancel somebody else's. Without this the count would go negative and the next repair
   * would look finished before it began.
   */
  it('ignores a repair that is finished twice', () => {
    const first = communityRepairStore.begin();
    const second = communityRepairStore.begin();

    first();
    first();

    expect(communityRepairStore.isRepairing()).toBe(true);
    second();
    expect(communityRepairStore.isRepairing()).toBe(false);
  });
});
