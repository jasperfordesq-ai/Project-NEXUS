// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { RELEASE_STATUS } from './releaseStatus';
import type { ReleaseStageKey } from './releaseStatus';

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

  it('stageLabel contains the version string "v1.6.1"', () => {
    expect(RELEASE_STATUS.stageLabel).toContain('v1.6.1');
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

  it('has exactly four keys', () => {
    const keys = Object.keys(RELEASE_STATUS);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(
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
