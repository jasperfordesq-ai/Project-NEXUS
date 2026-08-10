// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  SAFE_GREP_PATTERN,
  isolatedRunnerArgs
} = require('../scripts/accessibility-isolated-selection');

describe('isolated accessibility selection', () => {
  it('selects only the documented public, keyboard, and resilience gates', () => {
    expect(isolatedRunnerArgs([])).toEqual([`--grep=${SAFE_GREP_PATTERN}`]);
    expect(SAFE_GREP_PATTERN).toContain('default-English resilient presentation gate');
    expect(SAFE_GREP_PATTERN).toContain('representative public-page accessibility gate');
    expect(SAFE_GREP_PATTERN).toContain('keyboard, focus, error, and forced-colour gate');
    expect(SAFE_GREP_PATTERN).not.toContain('authenticated-page');
    expect(SAFE_GREP_PATTERN).not.toContain('Arabic RTL');
  });

  it('cannot be widened by caller-supplied grep or grep-invert arguments', () => {
    expect(isolatedRunnerArgs(['--grep=authenticated-page', '--grep-invert', 'public-page'])).toEqual([
      `--grep=${SAFE_GREP_PATTERN}`
    ]);
    expect(isolatedRunnerArgs(['-g', 'Arabic RTL', 'public-pages.spec.js'])).toEqual([
      'public-pages.spec.js',
      `--grep=${SAFE_GREP_PATTERN}`
    ]);
  });

  it('leaves manual inspection mode free of Playwright selection arguments', () => {
    expect(isolatedRunnerArgs(['--manual'])).toEqual(['--manual']);
  });
});
