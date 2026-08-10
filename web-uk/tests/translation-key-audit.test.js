// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

'use strict';

const { auditTranslationKeys } = require('../scripts/audit-translation-keys');

describe('complete static translation key audit', () => {
  it('resolves every complete static t()/tc() key used by Web UK source', () => {
    const result = auditTranslationKeys();

    expect(result.references).toBeGreaterThan(6000);
    expect(result.uniqueKeys).toBeGreaterThan(4500);
    expect(result.unresolved).toEqual([]);
  });
});
