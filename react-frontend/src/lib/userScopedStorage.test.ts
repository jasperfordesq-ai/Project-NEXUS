// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it } from 'vitest';
import { clearUserScopedStorage, userScopedStorageKey } from './userScopedStorage';

describe('userScopedStorage (F-109)', () => {
  afterEach(() => localStorage.clear());

  it('names the community and the member in the key', () => {
    expect(userScopedStorageKey('compose-draft-event', 2, 17)).toBe('compose-draft-event:t2:u17');
    expect(userScopedStorageKey('compose-draft-event', undefined, null)).toBe('compose-draft-event:t-:uanon');
  });

  it('clears only member-private drafts and searches', () => {
    localStorage.setItem('compose-draft-goal:t2:u17', '{}');
    localStorage.setItem('nexus:recent-searches:members:t2:u17', '[]');
    localStorage.setItem('nexus_recent_searches', '[]');
    localStorage.setItem('marketplace-listing-draft:t2:u17', '{}');
    localStorage.setItem('nexus_theme', 'dark');
    localStorage.setItem('nexus_trusted_device', 'keep');

    clearUserScopedStorage();

    expect(Object.keys(localStorage).sort()).toEqual(['nexus_theme', 'nexus_trusted_device']);
  });
});
