// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  exitCodeForMissingContracts,
  requiredQueryForGetter,
} = require('./audit-api-field-coverage-helpers.cjs');

describe('response-contract required query discovery', () => {
  it('uses a discovered listing for both comment getter families', () => {
    expect(requiredQueryForGetter('getComments', 165)).toEqual({
      target_type: 'listing',
      target_id: '165',
    });
    expect(requiredQueryForGetter('getExchangeComments', 165)).toEqual({
      target_type: 'listing',
      target_id: '165',
    });
  });

  it('does not invent query parameters for unrelated getters', () => {
    expect(requiredQueryForGetter('getWallet', 165)).toBeNull();
  });
});

describe('response-contract audit result', () => {
  it('fails closed when any checked endpoint is missing a required field', () => {
    expect(exitCodeForMissingContracts(0)).toBe(0);
    expect(exitCodeForMissingContracts(1)).toBe(1);
    expect(exitCodeForMissingContracts(8)).toBe(1);
  });
});
