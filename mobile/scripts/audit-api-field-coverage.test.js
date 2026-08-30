// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  auditOutputOptions,
  classifyGetterBody,
  exitCodeForMissingContracts,
  fetchTimeoutMs,
  requiredQueryForGetter,
} = require('./audit-api-field-coverage-helpers.cjs');

describe('response-contract machine-readable output options', () => {
  it('separates module filters from the JSON output path', () => {
    expect(auditOutputOptions(['marketplace', '--verbose', '--json', 'audit.json'])).toEqual({
      verbose: true,
      jsonOut: 'audit.json',
      only: ['marketplace'],
    });
  });

  it('rejects a missing JSON output path', () => {
    expect(() => auditOutputOptions(['--json'])).toThrow('--json requires an output path');
  });
});

describe('response-contract getter classification', () => {
  it('separates raw passthroughs, runtime-validated contracts, and unvalidated mappings', () => {
    expect(classifyGetterBody('return api.get<Foo>(endpoint);')).toBe('passthrough');
    expect(classifyGetterBody('return parseContract(endpoint, fooSchema, response);')).toBe('validated');
    expect(classifyGetterBody('const response = await api.get<unknown>(endpoint); return parseContract(endpoint, fooSchema, response);')).toBe('validated');
    expect(classifyGetterBody('return { data: response.items.map(mapItem) };')).toBe('mapped');
  });
});

describe('response-contract request timeout', () => {
  it('uses a bounded default and accepts a positive override', () => {
    expect(fetchTimeoutMs(undefined)).toBe(10_000);
    expect(fetchTimeoutMs('2500')).toBe(2_500);
    expect(fetchTimeoutMs('0')).toBe(10_000);
    expect(fetchTimeoutMs('not-a-number')).toBe(10_000);
  });
});

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
