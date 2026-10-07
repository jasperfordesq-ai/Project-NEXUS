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
      'accessibility', 'certificates', 'waitlist', 'swaps', 'expenses', 'donations']);
    expect(enabled('recommended')).toBe(true);
    expect(volunteeringSections(undefined).tools).toHaveLength(10);
    expect(volunteeringSections({ volunteering_config: [] }).tools).toHaveLength(10);
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
    // Tabs of the volunteering page itself, unknown names, and the qualifications
    // register (not on this site yet) open nothing.
    expect(pageFor('applications')).toBe('');
    expect(pageFor('credentials')).toBe('');
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
});
