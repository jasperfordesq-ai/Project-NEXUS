// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { safeguardingRedirectTarget } from './safeguardingRedirect';

/**
 * Every link written before the four tabs became pages must still land on the
 * page it meant — the broker dashboard tiles, the guide and old bookmarks.
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
    ['?tab=flagged', '/broker/safeguarding/flagged-messages'],
    ['?filter=unreviewed', '/broker/safeguarding/flagged-messages?filter=unreviewed'],
    ['?filter=critical', '/broker/safeguarding/flagged-messages?filter=critical'],
    ['?filter=reviewed', '/broker/safeguarding/flagged-messages?filter=reviewed'],
  ])('%s → %s', (search, expected) => {
    expect(safeguardingRedirectTarget(search)).toBe(expected);
  });
});
