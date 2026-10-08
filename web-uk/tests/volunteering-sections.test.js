// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's volunteering section switches (lib/volunteering-sections.js, gap B9).
 * The rule must match the website's isTabEnabled: off only when a setting is false,
 * absent counts as on, and two sections also need their feature switch.
 */

const { volunteeringSections, sectionEnabled } = require('../src/lib/volunteering-sections');

describe('volunteering section switches', () => {
  it('treats a community with no settings as having every section on', () => {
    const { tools, enabled } = volunteeringSections({});
    expect(tools.map((tool) => tool.section)).toEqual(['hours', 'alerts', 'wellbeing', 'safeguarding',
      'accessibility', 'credentials', 'certificates', 'waitlist', 'swaps', 'expenses', 'donations']);
    expect(enabled('recommended')).toBe(true);
    expect(volunteeringSections(undefined).tools).toHaveLength(11);
    expect(volunteeringSections({ volunteering_config: [] }).tools).toHaveLength(11);
  });

  it('turns a section off only when its setting is false', () => {
    expect(sectionEnabled({ 'volunteering.tab_wellbeing': false }, 'wellbeing')).toBe(false);
    expect(sectionEnabled({ 'volunteering.tab_wellbeing': '0' }, 'wellbeing')).toBe(false);
    expect(sectionEnabled({ 'volunteering.tab_wellbeing': true }, 'wellbeing')).toBe(true);
    expect(sectionEnabled({ 'volunteering.tab_wellbeing': null }, 'wellbeing')).toBe(true);
  });

  it('maps a hyphenated section to its underscored setting', () => {
    expect(sectionEnabled({ 'volunteering.tab_community_projects': false }, 'community-projects')).toBe(false);
  });

  it('also needs the feature switch for recommended shifts and expenses', () => {
    expect(sectionEnabled({ 'volunteering.enable_matching': false }, 'recommended')).toBe(false);
    expect(sectionEnabled({ 'volunteering.expenses_enabled': false }, 'expenses')).toBe(false);
    expect(sectionEnabled({ 'volunteering.expenses_enabled': false }, 'donations')).toBe(true);
  });

  // Gap B10: notification links carry the website's section names.
  it('opens the page a website section name lives on', () => {
    const { pageFor } = volunteeringSections({});
    expect(pageFor('hours')).toBe('/volunteering/hours');
    expect(pageFor('swaps')).toBe('/volunteering/swaps');
    expect(pageFor('training')).toBe('/volunteering/training');
    expect(pageFor('safeguarding')).toBe('/volunteering/training');
    expect(pageFor('alerts')).toBe('/volunteering/emergency-alerts');
    expect(pageFor('organisations')).toBe('/volunteering/my-organisations');
    // The website calls the qualifications register "credentials"; it has been on
    // this site since gap B15 (7 Oct 2026).
    expect(pageFor('credentials')).toBe('/volunteering/qualifications');
    expect(pageFor('qualifications')).toBe('/volunteering/qualifications');
    // Tabs of the volunteering page itself and unknown names open nothing.
    expect(pageFor('applications')).toBe('');
    expect(pageFor('constructor')).toBe('');
    expect(pageFor('')).toBe('');
  });

  it('opens nothing for a section the community has switched off', () => {
    const { pageFor } = volunteeringSections({ volunteering_config: { 'volunteering.tab_safeguarding': false, 'volunteering.expenses_enabled': false } });
    expect(pageFor('training')).toBe('');
    expect(pageFor('expenses')).toBe('');
    expect(pageFor('hours')).toBe('/volunteering/hours');
  });

  it('never lists the old document-upload page', () => {
    expect(volunteeringSections({}).tools.some((tool) => tool.href.includes('credentials'))).toBe(false);
  });

  // Gap B5 (8 Oct 2026): group sign-ups is the one section that is OFF unless the
  // community has switched it on (owner decision 2026-10-06), so an absent setting
  // counts as off here, the opposite of every other section.
  it('lists group sign-ups only when the community has switched it on', () => {
    expect(sectionEnabled({}, 'group-signups')).toBe(false);
    expect(sectionEnabled({ 'volunteering.tab_group_signups': false }, 'group-signups')).toBe(false);
    expect(sectionEnabled({ 'volunteering.tab_group_signups': true }, 'group-signups')).toBe(true);
    expect(sectionEnabled({ 'volunteering.tab_group_signups': '1' }, 'group-signups')).toBe(true);

    expect(volunteeringSections({}).tools.some((tool) => tool.href === '/volunteering/group-signups')).toBe(false);
    const on = volunteeringSections({ volunteering_config: { 'volunteering.tab_group_signups': true } });
    expect(on.tools.map((tool) => tool.section)).toContain('group-signups');
    expect(on.tools.find((tool) => tool.section === 'group-signups')).toEqual({
      section: 'group-signups',
      href: '/volunteering/group-signups',
      labelKey: 'govuk_alpha_volunteering.group_signups.nav_link'
    });
    expect(on.pageFor('group-signups')).toBe('/volunteering/group-signups');
    expect(volunteeringSections({}).pageFor('group-signups')).toBe('');
  });
});
