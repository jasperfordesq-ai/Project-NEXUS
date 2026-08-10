// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  getContributors,
  getContributorGroups,
  getResearchFoundation
} = require('../src/lib/contributors');

describe('contributors.json validation', () => {
  describe('getContributors', () => {
    it('should load contributors from JSON file', () => {
      const contributors = getContributors();
      expect(Array.isArray(contributors)).toBe(true);
    });

    it('should have at least one contributor', () => {
      const contributors = getContributors();
      expect(contributors.length).toBeGreaterThan(0);
    });

    it('should have valid structure for all contributors', () => {
      const contributors = getContributors();

      for (const contributor of contributors) {
        expect(contributor).toHaveProperty('name');
        expect(contributor).toHaveProperty('role');
        expect(contributor).toHaveProperty('type');
        expect(typeof contributor.name).toBe('string');
        expect(typeof contributor.role).toBe('string');
        expect(['creator', 'founder', 'contributor', 'acknowledgement']).toContain(
          contributor.type
        );
      }
    });
  });

  describe('getContributorGroups', () => {
    it('should return grouped contributors', () => {
      const groups = getContributorGroups();
      expect(groups).toHaveProperty('creator');
      expect(groups).toHaveProperty('founders');
      expect(groups).toHaveProperty('contributors');
      expect(groups).toHaveProperty('acknowledgements');
    });

    it('should have exactly one creator (Jasper Ford)', () => {
      const groups = getContributorGroups();
      expect(groups.creator).not.toBeNull();
      expect(groups.creator.name).toBe('Jasper Ford');
      expect(groups.creator.type).toBe('creator');
    });

    it('should have Mary Casey as a founder', () => {
      const groups = getContributorGroups();
      const maryFounder = groups.founders.find(f => f.name === 'Mary Casey');
      expect(maryFounder).toBeDefined();
      expect(maryFounder.type).toBe('founder');
    });

    it('should have at least one contributor', () => {
      const groups = getContributorGroups();
      expect(groups.contributors.length).toBeGreaterThan(0);
    });

    it('should have Steven J. Kelly as a contributor', () => {
      const groups = getContributorGroups();
      const steven = groups.contributors.find(c => c.name === 'Steven J. Kelly');
      expect(steven).toBeDefined();
      expect(steven.role).toBe('Community insight, product thinking');
    });

    it('should have Sarah Bird as a contributor', () => {
      const groups = getContributorGroups();
      const sarah = groups.contributors.find(c => c.name === 'Sarah Bird');
      expect(sarah).toBeDefined();
      expect(sarah.role).toBe('CEO, Timebanking UK');
    });

    it('should have at least one acknowledgement', () => {
      const groups = getContributorGroups();
      expect(groups.acknowledgements.length).toBeGreaterThan(0);
    });

    it('should have West Cork Development Partnership in acknowledgements', () => {
      const groups = getContributorGroups();
      const wcdp = groups.acknowledgements.find(
        a => a.name === 'West Cork Development Partnership'
      );
      expect(wcdp).toBeDefined();
    });
  });

  describe('getResearchFoundation', () => {
    it('should return the research foundation contributor', () => {
      const rf = getResearchFoundation();
      expect(rf).not.toBeNull();
      expect(rf.role).toBe('Research Foundation');
    });

    it('should be West Cork Development Partnership', () => {
      const rf = getResearchFoundation();
      expect(rf).not.toBeNull();
      expect(rf.name).toBe('West Cork Development Partnership');
    });
  });

  describe('NOTICE compliance', () => {
    it('should include all required contributors per NOTICE file', () => {
      const contributors = getContributors();
      const names = contributors.map(c => c.name);

      // Required per NOTICE file
      expect(names).toContain('Jasper Ford');
      expect(names).toContain('Mary Casey');
      expect(names).toContain('Steven J. Kelly');
      expect(names).toContain('Sarah Bird');
      expect(names).toContain('West Cork Development Partnership');
      expect(names).toContain('Fergal Conlon');
    });

    it('should have Fergal Conlon as SICAP Manager', () => {
      const contributors = getContributors();
      const fergal = contributors.find(c => c.name === 'Fergal Conlon');
      expect(fergal).toBeDefined();
      expect(fergal.role).toBe('SICAP Manager');
    });
  });
});
