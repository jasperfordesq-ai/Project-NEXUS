// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  run,
  isUpdatesResourcesScript,
  isMetroBundleInvocation,
  retryableStep,
  MAX_ATTEMPTS,
} = require('./node-retrying.cjs');

const UPDATES = 'C:\\tmp\\x\\node_modules\\expo-updates\\utils\\build\\createUpdatesResources.js';
const BUNDLER = 'C:\\tmp\\x\\node_modules\\@expo\\cli\\build\\bin\\cli';

function spawnReturning(...statuses) {
  const calls = [];
  const spawn = (execPath, args) => {
    calls.push(args);
    return { status: statuses[Math.min(calls.length, statuses.length) - 1] };
  };
  return { spawn, calls };
}

describe('node-retrying', () => {
  it('recognises the updates script that crashes at teardown, with either slash', () => {
    expect(isUpdatesResourcesScript(UPDATES)).toBe(true);
    expect(isUpdatesResourcesScript(UPDATES.replace(/\\/g, '/'))).toBe(true);
    expect(isUpdatesResourcesScript(BUNDLER)).toBe(false);
  });

  // Seen building version code 11 (2026-09-12): the same 0xC0000005, in the Metro
  // step, AFTER "Done writing bundle output" with a complete bundle on disk. This
  // file's first version deliberately excluded the bundler because it had not
  // been seen crashing there yet.
  it('recognises the Metro bundle step only when the command really is export:embed', () => {
    expect(isMetroBundleInvocation([BUNDLER, 'export:embed', '--platform', 'android'])).toBe(true);
    expect(isMetroBundleInvocation([BUNDLER.replace(/\\/g, '/'), 'export:embed'])).toBe(true);
    // The same binary runs other commands; those must not be retried.
    expect(isMetroBundleInvocation([BUNDLER, 'prebuild'])).toBe(false);
    expect(isMetroBundleInvocation([BUNDLER])).toBe(false);
    expect(isMetroBundleInvocation(['C:\\x\\other.js', 'export:embed'])).toBe(false);
    expect(isMetroBundleInvocation(undefined)).toBe(false);
  });

  it('names the step it retried, so the build log says which one crashed', () => {
    expect(retryableStep([UPDATES, 'android'])).toBe('createUpdatesResources.js');
    expect(retryableStep([BUNDLER, 'export:embed'])).toBe('the Metro bundle (export:embed)');
    expect(retryableStep([BUNDLER, 'prebuild'])).toBeNull();
  });

  it('retries the Metro bundle step after an access violation', () => {
    const { spawn, calls } = spawnReturning(-1073741819, 0);
    const log = [];
    expect(run([BUNDLER, 'export:embed'], { spawn, log: (m) => log.push(m) })).toBe(0);
    expect(calls).toHaveLength(2);
    expect(log[0]).toContain('Metro bundle');
  });

  it('passes an ordinary Metro failure straight through instead of rebundling three more times', () => {
    const { spawn, calls } = spawnReturning(1);
    expect(run([BUNDLER, 'export:embed'], { spawn, log: () => {} })).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('always preloads node-clean-exit.cjs in front of the requested script', () => {
    const { spawn, calls } = spawnReturning(0);
    expect(run([BUNDLER, 'export:embed'], { spawn, log: () => {} })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('--require');
    expect(calls[0][1]).toMatch(/node-clean-exit\.cjs$/);
    expect(calls[0].slice(2)).toEqual([BUNDLER, 'export:embed']);
  });

  it('retries createUpdatesResources.js after an access violation and returns the clean exit', () => {
    const { spawn, calls } = spawnReturning(3221225477, -1073741819, 0);
    const log = [];
    expect(run([UPDATES, 'android'], { spawn, log: (m) => log.push(m) })).toBe(0);
    expect(calls).toHaveLength(3);
    expect(log).toHaveLength(2);
  });

  it('gives up after the bounded number of attempts and reports the crash', () => {
    const { spawn, calls } = spawnReturning(3221225477);
    expect(run([UPDATES], { spawn, log: () => {} })).toBe(3221225477);
    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });

  it('never retries another script, whatever it died of', () => {
    const { spawn, calls } = spawnReturning(3221225477);
    expect(run([BUNDLER, 'prebuild'], { spawn, log: () => {} })).toBe(3221225477);
    expect(calls).toHaveLength(1);
  });

  it('passes an ordinary failure of the updates script straight through', () => {
    const { spawn, calls } = spawnReturning(1);
    expect(run([UPDATES], { spawn, log: () => {} })).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('treats a killed child (no status) as failure without retrying forever', () => {
    const { spawn, calls } = spawnReturning(null);
    expect(run([UPDATES], { spawn, log: () => {} })).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
