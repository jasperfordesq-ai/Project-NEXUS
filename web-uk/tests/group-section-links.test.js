// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The group page links to the sections that live in their own route files.
 * A link must appear only when its page would actually open for this viewer:
 * the community has the section switched on (group_tabs / features) and the
 * viewer has the standing that page requires. Otherwise the link leads to a
 * 403 or 404, which is what React's groupSections.ts avoids.
 */

const { groupSectionLinks } = require('../src/routes/groups');

const everythingOn = { features: { ideation_challenges: true }, group_tabs: {} };
const paths = (links) => links.map((link) => link.path.replace('/groups/7/', ''));

describe('group page section links', () => {
  it('gives an active member every member section, and no admin tools', () => {
    const links = groupSectionLinks(everythingOn, 7, { isMember: true, isAdmin: false });
    expect(paths(links.member)).toEqual(['qa', 'wiki', 'tasks', 'gallery', 'challenges', 'channels']);
    expect(links.admin).toEqual([]);
  });

  it('gives a group admin the admin tools as well', () => {
    const links = groupSectionLinks(everythingOn, 7, { isMember: true, isAdmin: true });
    expect(paths(links.admin)).toEqual(['analytics', 'data-export', 'webhooks']);
  });

  it('withholds channels from an admin who is not an active member, as the channel pages do', () => {
    const links = groupSectionLinks(everythingOn, 7, { isMember: false, isAdmin: true });
    expect(paths(links.member)).not.toContain('channels');
    expect(paths(links.member)).toContain('qa');
  });

  it('shows nothing to someone outside the group', () => {
    const links = groupSectionLinks(everythingOn, 7, { isMember: false, isAdmin: false });
    expect(links.member).toEqual([]);
    expect(links.admin).toEqual([]);
  });

  it('hides a section the community has switched off', () => {
    const tenant = { features: { ideation_challenges: true }, group_tabs: { tab_qa: false, tab_media: '0', tab_analytics: false } };
    const links = groupSectionLinks(tenant, 7, { isMember: true, isAdmin: true });
    expect(paths(links.member)).not.toContain('qa');
    expect(paths(links.member)).not.toContain('gallery');
    expect(paths(links.admin)).not.toContain('analytics');
    expect(paths(links.member)).toContain('wiki');
  });

  it('hides channels when the community lacks the feature the channel API needs', () => {
    const links = groupSectionLinks({ features: { ideation_challenges: false }, group_tabs: {} }, 7, { isMember: true, isAdmin: false });
    expect(paths(links.member)).not.toContain('channels');
  });
});
