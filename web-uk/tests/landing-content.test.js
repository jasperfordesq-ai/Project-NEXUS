// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { landingHomeContent } = require('../src/lib/landing-content');

describe('landingHomeContent', () => {
  it('returns nothing for a community that never used the landing page editor', () => {
    expect(landingHomeContent(null)).toEqual({ heading: '', intro: '', howItWorks: null, closing: null });
    expect(landingHomeContent({})).toEqual({ heading: '', intro: '', howItWorks: null, closing: null });
  });

  it('joins the two halves of the heading and trims the wording', () => {
    const result = landingHomeContent({
      sections: [{ id: 'hero', type: 'hero', enabled: true, content: { headline_1: ' Timebanking ', headline_2: 'across the UK', subheadline: ' Find a timebank near you. ' } }]
    });
    expect(result.heading).toBe('Timebanking across the UK');
    expect(result.intro).toBe('Find a timebank near you.');
  });

  it('uses one half of the heading on its own', () => {
    const result = landingHomeContent({ sections: [{ id: 'hero', enabled: true, content: { headline_2: 'Community Space' } }] });
    expect(result.heading).toBe('Community Space');
  });

  it('leaves out sections switched off in the editor', () => {
    const result = landingHomeContent({
      sections: [
        { id: 'hero', enabled: false, content: { headline_1: 'Hidden' } },
        { id: 'how_it_works', enabled: false, content: { steps: [{ title: 'Hidden step', description: '' }] } },
        { id: 'cta', enabled: false, content: { title: 'Hidden closing' } }
      ]
    });
    expect(result).toEqual({ heading: '', intro: '', howItWorks: null, closing: null });
  });

  it('shows "how it works" and the closing message only when the community wrote them', () => {
    const standard = landingHomeContent({
      sections: [{ id: 'how_it_works', enabled: true }, { id: 'cta', enabled: true, content: { button_text: 'Go' } }]
    });
    expect(standard.howItWorks).toBeNull();
    expect(standard.closing).toBeNull();

    const written = landingHomeContent({
      sections: [
        { id: 'how_it_works', enabled: true, content: { title: 'How it works here', steps: [{ title: 'Join', description: 'Sign up' }, { title: '', description: '' }] } },
        { id: 'cta', enabled: true, content: { description: 'Join us today.' } }
      ]
    });
    expect(written.howItWorks).toEqual({ title: 'How it works here', subtitle: '', steps: [{ title: 'Join', description: 'Sign up' }] });
    expect(written.closing).toEqual({ title: '', description: 'Join us today.' });
  });

  it('ignores wording that is not text', () => {
    const result = landingHomeContent({ sections: [{ id: 'hero', enabled: true, content: { headline_1: 42, subheadline: { html: '<b>x</b>' } } }] });
    expect(result.heading).toBe('');
    expect(result.intro).toBe('');
  });
});
