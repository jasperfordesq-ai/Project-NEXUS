// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * At the top level Laravel sends the current threshold again as the next one
 * (never null), so "you have reached the highest level" never showed (29 Oct 2026).
 */

const { normalizeProfile } = require('../src/routes/achievements');

const profile = (current, next) => ({ data: { level: 10, xp: 9000, level_progress: { xp_for_current_level: current, xp_for_next_level: next, progress_percentage: 100 } } });

it('recognises the top level from the repeated threshold', () => {
  expect(normalizeProfile(profile(8000, 8000), 0).atMaxLevel).toBe(true);
  expect(normalizeProfile(profile(8000, null), 0).atMaxLevel).toBe(true);
});

it('does not treat an ordinary level as the top', () => {
  expect(normalizeProfile(profile(1000, 2000), 0).atMaxLevel).toBe(false);
  expect(normalizeProfile({ data: { level: 1 } }, 0).atMaxLevel).toBe(false);
});
