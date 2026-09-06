// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/profile.json') as Record<string, unknown>;
const irish = require('./ga/profile.json') as Record<string, unknown>;

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [nestedPath, nestedValue] of flatten(item as Record<string, unknown>, path)) {
        result.set(nestedPath, nestedValue);
      }
    } else if (typeof item === 'string') {
      result.set(path, item);
    }
  }
  return result;
}

describe('mobile Irish profile support content', () => {
  it('does not fall back to English in support navigation, help, pages, or the contact form', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const reviewedCorePaths = new Set([
      'support.title',
      'support.heading',
      'support.description',
      'support.open',
    ]);
    /*
      `support.contactForm.message` is "Message"/"Teachtaireacht" and
      `support.contactForm.name` is "Your name"/"D’ainm" — short labels that are
      still genuinely translated, so they stay in scope. Nothing here is exempt.
    */
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      reviewedCorePaths.has(path)
      || path.startsWith('support.items.')
      || path.startsWith('support.faqs.')
      || path.startsWith('support.page.')
      || path.startsWith('support.contactForm.'),
    );

    expect(reviewedPaths.length).toBeGreaterThan(30);

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
  });

  it('has dropped the invented policy summaries the app used to show instead of the real documents', () => {
    /*
      🔴 `support.docs.<key>.section1Title` … fed a bottom sheet that presented a
      hand-written three-paragraph summary as though it were the community's own
      About / Contact / policy text, with "Open on the website" for the real
      thing. Those screens now read the real document, so the keys are gone. If
      they come back, so has the fabricated content.
    */
    for (const locale of [english, irish]) {
      const support = locale.support as Record<string, unknown>;
      expect(support.docs).toBeUndefined();
      expect(support.openWeb).toBeUndefined();
    }
  });
});
