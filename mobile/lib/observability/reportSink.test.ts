// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The indirection that lets `lib/storage.ts` report without importing the reporter.
 *
 * 🔴 Worth testing properly because the two obvious alternatives both produced FALSE
 * GREEN results, which is the failure mode this project keeps meeting:
 *
 *  * Static imports both ways: a real cycle, and it broke 10 storage tests by pulling
 *    `expo-constants` into a minimal test registry.
 *  * `await import()`: fired nothing under Jest (no `--experimental-vm-modules`), so the
 *    test asserting "a failed write is reported" passed with ZERO calls to the reporter.
 *
 * So the assertions here are about the contract that replaced them, and the last one
 * checks the registration actually happens rather than assuming it.
 */

import {
  __resetSinkForTests,
  hasReporter,
  registerReporter,
  reportToSink,
} from './reportSink';

describe('reportSink', () => {
  beforeEach(() => {
    __resetSinkForTests();
  });

  it('imports nothing, so anything may depend on it', () => {
    // The property that makes it safe in both directions. Asserted on the source, since
    // no runtime behaviour can show it: an import added here would silently reintroduce
    // the coupling this module exists to remove.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');

    const source = fs.readFileSync(path.join(__dirname, 'reportSink.ts'), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(withoutComments).not.toMatch(/^\s*import\s/m);
    expect(withoutComments).not.toMatch(/require\(/);
  });

  it('drops reports when nothing is listening', () => {
    // Correct degradation: diagnostics must never be load-bearing, and modules can call
    // this before the app has started.
    expect(hasReporter()).toBe(false);
    expect(() => reportToSink(new Error('nobody home'))).not.toThrow();
  });

  it('forwards to a registered reporter, with context', () => {
    const reporter = jest.fn();
    registerReporter(reporter);

    reportToSink(new Error('keystore full'), { storage_op: 'set', key: 'auth_token' });

    expect(reporter).toHaveBeenCalledWith(expect.any(Error), {
      storage_op: 'set',
      key: 'auth_token',
    });
  });

  it('defaults the context so a caller can omit it', () => {
    const reporter = jest.fn();
    registerReporter(reporter);

    reportToSink('a bare string');

    expect(reporter).toHaveBeenCalledWith('a bare string', {});
  });

  it('🔴 swallows a reporter that throws', () => {
    // The reporter must not be able to become the failure it is reporting.
    registerReporter(() => {
      throw new Error('reporter exploded');
    });

    expect(() => reportToSink(new Error('original'))).not.toThrow();
  });

  it('🔴 the reporter module actually registers itself', () => {
    // The wiring, not the plumbing. Without this, storage failures would go nowhere and
    // every other test here would still pass — exactly the gap that made the dynamic
    // import look fine.
    //
    // 🔴 `require` inside isolateModules, NOT `await import()`. The first version of this
    // test used a dynamic import and failed for the same reason the code it was written
    // to check had failed: Jest cannot execute a native dynamic import without
    // --experimental-vm-modules. Worth leaving this note, because the mistake was made
    // twice in one hour, once in the code and once in the test for it.
    jest.isolateModules(() => {
      jest.doMock('@sentry/react-native', () => ({
        captureMessage: jest.fn(),
        captureException: jest.fn(),
      }));
      jest.doMock('@/lib/storage', () => ({ storage: { get: jest.fn().mockResolvedValue('t') } }));

      const sink = require('./reportSink') as typeof import('./reportSink');
      expect(sink.hasReporter()).toBe(false);

      require('./report');

      expect(sink.hasReporter()).toBe(true);
    });
  });
});
