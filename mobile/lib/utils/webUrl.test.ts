// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/constants', () => ({ APP_URL: 'https://app.example.test/' }));

import { buildWebUrl } from './webUrl';

describe('buildWebUrl', () => {
  /**
   * 🔴 On the shared host a slug-less path renders the platform landing page and
   * the destination is lost, so the slug is the whole point of this helper.
   */
  it('prefixes the community slug so the shared host resolves the right community', () => {
    expect(buildWebUrl('hour-timebank', '/courses/instructor/new'))
      .toBe('https://app.example.test/hour-timebank/courses/instructor/new');
  });

  it('tolerates a trailing slash on APP_URL and a missing leading slash on the path', () => {
    expect(buildWebUrl('hour-timebank', 'podcasts/studio'))
      .toBe('https://app.example.test/hour-timebank/podcasts/studio');
  });

  it('never emits /undefined/ when the tenant is not loaded yet', () => {
    expect(buildWebUrl(undefined, '/settings/verify-identity'))
      .toBe('https://app.example.test/settings/verify-identity');
    expect(buildWebUrl(null, '/settings/verify-identity'))
      .toBe('https://app.example.test/settings/verify-identity');
    expect(buildWebUrl('  ', '/settings/verify-identity'))
      .toBe('https://app.example.test/settings/verify-identity');
  });

  it('strips stray slashes from the slug and encodes anything unsafe', () => {
    expect(buildWebUrl('/hour-timebank/', '/members/7')).toBe('https://app.example.test/hour-timebank/members/7');
    expect(buildWebUrl('odd slug', '/x')).toBe('https://app.example.test/odd%20slug/x');
  });
});
