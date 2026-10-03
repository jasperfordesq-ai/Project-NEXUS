// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { flaggedMessagesTarget, safeguardingRedirectTarget } from './safeguardingRedirect';

/**
 * Every link written before the four tabs became pages — and before flagged
 * messages joined the Messages queue — must still land on the page it meant:
 * the broker dashboard tiles, the guide, bell notifications and bookmarks.
 */
describe('safeguardingRedirectTarget', () => {
  it.each([
    ['', '/broker/safeguarding/support-needs'],
    ['?tab=preferences', '/broker/safeguarding/support-needs'],
    ['?tab=preferences&filter=triggers', '/broker/safeguarding/support-needs?show=all'],
    // Safeguarding alerts about one member (NotifySafeguardingStaff and friends).
    ['?user=42', '/broker/safeguarding/support-needs?user=42'],
    ['?tab=assignments', '/broker/safeguarding/guardians'],
    ['?tab=guardians', '/broker/safeguarding/guardians'],
    ['?tab=assignments&filter=active', '/broker/safeguarding/guardians?filter=active'],
    ['?tab=assignments&filter=consented', '/broker/safeguarding/guardians?filter=consented'],
    ['?tab=support', '/broker/safeguarding/support-actions'],
    // Flagged messages now live in the Messages queue.
    ['?tab=flagged', '/broker/messages'],
    ['?filter=unreviewed', '/broker/messages'],
    ['?filter=critical', '/broker/messages?status=urgent'],
    ['?filter=reviewed', '/broker/messages?status=reviewed'],
  ])('%s → %s', (search, expected) => {
    expect(safeguardingRedirectTarget(search)).toBe(expected);
  });
});

describe('flaggedMessagesTarget (old /broker/safeguarding/flagged-messages links)', () => {
  it.each([
    [null, '/broker/messages'],
    ['unreviewed', '/broker/messages'],
    ['critical', '/broker/messages?status=urgent'],
    ['reviewed', '/broker/messages?status=reviewed'],
    ['all', '/broker/messages?status=all'],
    ['nonsense', '/broker/messages'],
  ])('%s → %s', (filter, expected) => {
    expect(flaggedMessagesTarget(filter)).toBe(expected);
  });
});
