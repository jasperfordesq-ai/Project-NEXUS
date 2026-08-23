// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Journey 7.16. Two things are pinned here, and both were mistakes made on the way to the
 * measurement rather than hypotheticals:
 *
 *   1. The app's entry point imports this module BEFORE `expo-router/entry`. Without that
 *      order the timer starts after the whole module graph has been evaluated and reports
 *      0ms — which it did, on a device, while the app took a second to open.
 *   2. `markAppReady()` is once-only. Fast Refresh re-mounts the root layout, and a second
 *      call would replace a real figure with a few milliseconds.
 */

import fs from 'node:fs';
import path from 'node:path';

import { markAppReady, resetStartupTimingForTests, startupTiming } from './startupTiming';

const MOBILE = path.resolve(__dirname, '..');

describe('the app entry point keeps start-up measurable', () => {
  it('runs the timer before expo-router, which is the whole reason index.js exists', () => {
    const entry = fs.readFileSync(path.join(MOBILE, 'index.js'), 'utf8');
    // The import STATEMENTS, not any mention: the file's own comment names both modules,
    // and matching prose had this assertion passing on the wrong evidence.
    const timing = entry.search(/^import\s+'@\/lib\/startupTiming';/m);
    const router = entry.search(/^import\s+'expo-router\/entry';/m);

    expect(timing).toBeGreaterThan(-1);
    expect(router).toBeGreaterThan(-1);
    // Sorting these imports alphabetically would silently reduce the measurement to 0ms.
    expect(timing).toBeLessThan(router);
  });

  it('is the entry point the app actually starts from', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('index.js');
  });

  it('has a bundle ceiling above the size last measured', () => {
    const budget = JSON.parse(fs.readFileSync(path.join(MOBILE, 'startup-budget.json'), 'utf8'));
    expect(budget.bundle.measuredBytes).toBeGreaterThan(0);
    expect(budget.bundle.ceilingBytes).toBeGreaterThan(budget.bundle.measuredBytes);
    // A ceiling far above the measurement is not a budget. 25% is generous already.
    expect(budget.bundle.ceilingBytes).toBeLessThan(budget.bundle.measuredBytes * 1.25);
  });
});

describe('markAppReady', () => {
  beforeEach(() => {
    resetStartupTimingForTests();
  });

  it('records the JavaScript phase and reports nothing before the first screen', () => {
    expect(startupTiming()).toBeNull();

    const result = markAppReady(Date.now() + 1234);

    expect(result.jsMs).toBeGreaterThanOrEqual(1234);
    expect(startupTiming()).toBe(result);
  });

  it('keeps the first figure when called again', () => {
    const first = markAppReady(Date.now() + 900);
    const second = markAppReady(Date.now() + 5);

    expect(second).toBe(first);
    expect(second.jsMs).toBeGreaterThanOrEqual(900);
  });

  it('reports the native marks as unavailable rather than inventing a number', () => {
    // 🔴 `performance.now()` alone counts from device BOOT — it returned 37,101,247 on the
    // emulator. Without React Native's `startTime` mark there is no zero, so the honest
    // answer is null.
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    const restore = perf?.now;
    if (perf) perf.now = () => 37_101_247;

    const result = markAppReady();

    expect(result.totalMs).toBeNull();
    expect(result.bundleEvalMs).toBeNull();

    if (perf && restore) perf.now = restore;
  });
});
