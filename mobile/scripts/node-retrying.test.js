// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { run, isUpdatesResourcesScript, MAX_ATTEMPTS } = require('./node-retrying.cjs');

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
  it('recognises the one script that crashes at teardown, with either slash', () => {
    expect(isUpdatesResourcesScript(UPDATES)).toBe(true);
    expect(isUpdatesResourcesScript(UPDATES.replace(/\\/g, '/'))).toBe(true);
    expect(isUpdatesResourcesScript(BUNDLER)).toBe(false);
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
    expect(run([BUNDLER], { spawn, log: () => {} })).toBe(3221225477);
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
