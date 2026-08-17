// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { auditIrishLocale } = require('../scripts/audit-irish-locale');

describe('generated Irish catalogue integrity', () => {
  it('contains no unreviewed English user-facing fallbacks', () => {
    const result = auditIrishLocale();

    expect(result.stringKeys).toBeGreaterThan(9000);
    expect(result.unreviewedEnglishFallbacks).toEqual([]);
  });

  it('preserves question punctuation from the English source', () => {
    const result = auditIrishLocale();

    expect(result.questionMarkMismatches).toEqual([]);
  });

  it('uses the reviewed member-facing Irish terminology', () => {
    const result = auditIrishLocale();

    expect(result.terminologyViolations).toEqual([]);
  });
});
