// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The members directory lists only the people it is allowed to list, and on a
 * community with hundreds of members that can be a small fraction of them. With
 * no explanation the page reads as broken or as though the community is empty.
 *
 * `directoryCoverage` builds that explanation from what the API reports:
 * `community_total` (everyone active) against the directory's own total, plus
 * `directory_criteria` naming the visibility rules actually in force. It must
 * stay silent when nothing is held back, and while the member is searching —
 * there the shortfall is their own query, not the directory's rules.
 *
 * There is deliberately no "recently active" rule: the directory has never
 * filtered on last login, and the copy must not imply that it does.
 */

const { directoryCoverage } = require('../src/routes/members');

/** Stand-in translator: echoes the key plus any interpolated values. */
function t(key, params) {
  if (!params) return key;
  return `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`;
}

describe('members directory coverage note', () => {
  it('explains the gap when the community is larger than the directory', () => {
    const coverage = directoryCoverage(
      { community_total: 369, directory_criteria: ['directory_opt_in'] },
      12,
      '',
      t
    );

    expect(coverage).not.toBeNull();
    expect(coverage.title).toBe('members.coverage_title(listed=12,joined=369)');
    expect(coverage.criteria).toEqual(['members.coverage_criteria_directory_opt_in']);
    expect(coverage.checkOwnLabel).toBe('members.coverage_check_own');
  });

  it('names every visibility rule the community applies, and no others', () => {
    const coverage = directoryCoverage(
      { community_total: 369, directory_criteria: ['directory_opt_in', 'avatar', 'bio'] },
      12,
      '',
      t
    );

    expect(coverage.criteria).toEqual([
      'members.coverage_criteria_directory_opt_in',
      'members.coverage_criteria_avatar',
      'members.coverage_criteria_bio'
    ]);
  });

  it('stays silent when every member is listed', () => {
    expect(
      directoryCoverage({ community_total: 369, directory_criteria: ['directory_opt_in'] }, 369, '', t)
    ).toBeNull();
  });

  it('stays silent while the member is searching', () => {
    expect(
      directoryCoverage({ community_total: 369, directory_criteria: ['directory_opt_in'] }, 12, 'ada', t)
    ).toBeNull();
  });

  it('stays silent when the backend does not report a community total', () => {
    expect(directoryCoverage({}, 12, '', t)).toBeNull();
    expect(directoryCoverage({ community_total: 'lots' }, 12, '', t)).toBeNull();
  });

  it('tolerates a missing criteria list rather than throwing', () => {
    const coverage = directoryCoverage({ community_total: 369 }, 12, '', t);

    expect(coverage).not.toBeNull();
    expect(coverage.criteria).toEqual([]);
  });
});
