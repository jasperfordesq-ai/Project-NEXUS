// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An Irish-speaking member must not be shown English when reading legal and
 * safety material.
 *
 * 🔴 This test used to guard `support.docs.terms.` … `support.docs.trust.` —
 * the hand-written policy summaries the support screen showed instead of the
 * community's real documents. Those keys are gone, and with them the summaries.
 * Left as it was, the filter matched nothing, the loop body never ran, and the
 * test went green while proving nothing at all. It now guards the two places
 * that material actually lives: the `legal` namespace, which is the chrome of
 * the document reader, and the support screen's own legal entries.
 *
 * The `expect(...).toBeGreaterThan` lines below are the point: they are what
 * stops this going hollow again the next time a key is renamed.
 */

const englishProfile = require('./en/profile.json') as Record<string, unknown>;
const irishProfile = require('./ga/profile.json') as Record<string, unknown>;
const englishLegal = require('./en/legal.json') as Record<string, unknown>;
const irishLegal = require('./ga/legal.json') as Record<string, unknown>;

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

function assertTranslated(
  english: Map<string, string>,
  irish: Map<string, string>,
  paths: string[],
) {
  for (const path of paths) {
    expect(irish.get(path)).toBeDefined();
    expect(irish.get(path)).not.toBe(english.get(path));
  }
}

describe('mobile Irish legal and safety content', () => {
  it('translates the document reader a member is sent to for terms, privacy, cookies and accessibility', () => {
    const english = flatten(englishLegal);
    const irish = flatten(irishLegal);
    const paths = [...english.keys()];

    expect(paths.length).toBeGreaterThan(10);
    assertTranslated(english, irish, paths);
  });

  it('translates the support screen entries that lead to those documents', () => {
    const english = flatten(englishProfile);
    const irish = flatten(irishProfile);
    const paths = [...english.keys()].filter((path) =>
      ['terms', 'privacy', 'cookies', 'accessibility', 'trust'].some(
        (key) => path.startsWith(`support.items.${key}.`),
      ),
    );

    expect(paths).toHaveLength(10);
    assertTranslated(english, irish, paths);
  });
});
