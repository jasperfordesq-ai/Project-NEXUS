// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Help & support form speaks every language the app does.
 *
 * A member who needs help is the member least able to work around an English
 * string in the middle of their own language — the form is how they reach a
 * person. So every one of its strings must exist in all six other locales, must
 * actually be translated (not English copied across, which passes a key-set
 * check while helping nobody), and must keep its placeholders, or the
 * reference and diagnostics lines would render with `{{…}}` holes.
 */

const LOCALES = ['ga', 'de', 'fr', 'it', 'pt', 'es'] as const;

function load(locale: string, namespace: string): Record<string, unknown> {
  return require(`./${locale}/${namespace}.json`) as Record<string, unknown>;
}

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

function placeholders(value: string): string[] {
  return (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();
}

const SCOPES: { namespace: string; prefixes: string[] }[] = [
  {
    namespace: 'profile',
    prefixes: ['support.request.', 'support.requestCard.', 'support.stillNeedHelp.', 'menuLabels.helpSupport', 'navDescriptions.helpSupport'],
  },
  { namespace: 'common', prefixes: ['errors.boundaryReport'] },
];

describe('Help & support translations', () => {
  for (const { namespace, prefixes } of SCOPES) {
    const english = flatten(load('en', namespace));
    const paths = [...english.keys()].filter((path) => prefixes.some((prefix) => path === prefix || path.startsWith(prefix)));

    it(`finds the ${namespace} strings it is meant to check`, () => {
      expect(paths.length).toBeGreaterThan(namespace === 'profile' ? 50 : 0);
    });

    it.each(LOCALES)(`${namespace}: %s has every string, translated, with its placeholders intact`, (locale) => {
      const translated = flatten(load(locale, namespace));
      const problems: string[] = [];

      for (const path of paths) {
        const source = english.get(path)!;
        const value = translated.get(path);
        if (value === undefined || value.trim() === '') {
          problems.push(`${path}: missing`);
          continue;
        }
        if (value === source) problems.push(`${path}: still English`);
        if (placeholders(value).join() !== placeholders(source).join()) problems.push(`${path}: placeholders differ`);
      }

      expect(problems).toEqual([]);
    });
  }
});
