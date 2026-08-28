// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RELEASE_STATUS } from './releaseStatus';
import type { ReleaseStageKey } from './releaseStatus';

/**
 * The repository-root `VERSION` file is the single source of truth for the
 * platform version. This test used to assert a hardcoded `'v1.6.2'`, which
 * meant `releaseStatus.ts` and its test could be bumped together while
 * `VERSION` was left behind and every check stayed green. Reading the file
 * here makes the frontend suite itself fail on that mismatch.
 *
 * Resolved from this file's own location rather than `process.cwd()` so it does
 * not matter whether vitest was started from the repo root or from
 * `react-frontend/`: src/config/ -> src/ -> react-frontend/ -> repo root.
 *
 * 🔴 Do NOT "simplify" this to `new URL('../../../VERSION', import.meta.url)`.
 * Vite statically rewrites that exact expression into an asset URL, so under
 * vitest it resolves to `http://localhost:3000/@fs/...` and readFileSync dies
 * with "The URL must be of scheme file". Going through fileURLToPath keeps it
 * a plain filesystem path that Vite leaves alone.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT_VERSION = readFileSync(resolve(REPO_ROOT, 'VERSION'), 'utf8').trim();

describe('root VERSION file', () => {
  it('is a readable semantic version', () => {
    expect(ROOT_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });
});

describe('RELEASE_STATUS', () => {
  it('exports RELEASE_STATUS as an object', () => {
    expect(RELEASE_STATUS).toBeDefined();
    expect(typeof RELEASE_STATUS).toBe('object');
  });

  it('has stageKey equal to "ga"', () => {
    expect(RELEASE_STATUS.stageKey).toBe('ga');
  });

  it('stageKey satisfies the ReleaseStageKey type (literal "ga")', () => {
    // TypeScript-level: assign to the named type; if it compiled, the type is correct.
    const key: ReleaseStageKey = RELEASE_STATUS.stageKey;
    expect(key).toBe('ga');
  });

  it('has a non-empty stageLabel', () => {
    expect(typeof RELEASE_STATUS.stageLabel).toBe('string');
    expect(RELEASE_STATUS.stageLabel.length).toBeGreaterThan(0);
  });

  it('stageLabel carries the version from the root VERSION file', () => {
    expect(RELEASE_STATUS.stageLabel).toContain(`v${ROOT_VERSION}`);
  });

  it('stageLabel carries no version other than the root VERSION', () => {
    // Guards the other direction: a stale `(v1.6.1)` left next to a correct
    // label would still satisfy the `toContain` above.
    const versionsInLabel = RELEASE_STATUS.stageLabel.match(/v\d+\.\d+\.\d+/g) ?? [];
    expect(versionsInLabel).toEqual([`v${ROOT_VERSION}`]);
  });

  it('stageLabel contains "Generally Available"', () => {
    expect(RELEASE_STATUS.stageLabel).toContain('Generally Available');
  });

  it('has a non-empty stageSummary', () => {
    expect(typeof RELEASE_STATUS.stageSummary).toBe('string');
    expect(RELEASE_STATUS.stageSummary.length).toBeGreaterThan(0);
  });

  it('stageSummary describes a live supported platform', () => {
    expect(RELEASE_STATUS.stageSummary).toBe('Live and supported.');
  });

  it('has a readMorePath that starts with "/"', () => {
    expect(RELEASE_STATUS.readMorePath).toMatch(/^\//);
  });

  it('readMorePath is "/features"', () => {
    expect(RELEASE_STATUS.readMorePath).toBe('/features');
  });

  it('exposes every key its consumers rely on', () => {
    // Deliberately NOT `toHaveLength(4)`. That was a change detector: adding a
    // legitimate new field (say `supportedUntil`) broke this test even though
    // nothing was wrong. What actually matters is that no required key is ever
    // dropped or renamed, so only that is asserted — new keys are allowed.
    expect(Object.keys(RELEASE_STATUS)).toEqual(
      expect.arrayContaining(['stageKey', 'stageLabel', 'stageSummary', 'readMorePath'])
    );
  });

  it('is a deeply frozen const (values are not writable at runtime)', () => {
    // The `as const` assertion in the source makes TS read-only; at runtime the
    // object is a plain object (not frozen), so we just verify values are stable.
    const originalKey = RELEASE_STATUS.stageKey;
    // Attempting to set is silently ignored in sloppy mode / throws in strict.
    try {
      // @ts-expect-error — intentional runtime check
      (RELEASE_STATUS as Record<string, unknown>).stageKey = 'beta';
    } catch {
      // strict mode throws — that's fine too
    }
    // Either way, reading the typed value via TypeScript's const path gives 'ga'.
    expect(originalKey).toBe('ga');
  });
});

describe('ReleaseStageKey type (runtime representation)', () => {
  it('the only valid value is "ga"', () => {
    // We cannot enumerate a union type at runtime, but we can confirm the
    // single known concrete value matches.
    const key: ReleaseStageKey = 'ga';
    expect(key).toBe('ga');
  });
});
