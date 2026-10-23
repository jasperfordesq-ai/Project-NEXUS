// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Public pages' search-result descriptions name the community (2026-10-23).
 * They were fixed sentences identical on every community, so search engines
 * saw the same snippet on every community's FAQ, contact, legal and guide
 * pages. Each page passes `{ name: branding.name }`; this pins that every
 * language keeps the placeholder and that English stays near the length
 * search results show.
 */
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['public', 'features_page.meta_description'],
  ['public', 'faq.meta_description'],
  ['public', 'contact.meta_description'],
  ['legal', 'terms.meta_description'],
  ['legal', 'privacy.meta_description'],
  ['legal', 'accessibility.meta_description'],
  ['legal', 'cookies.meta_description'],
  ['legal', 'page_meta.community_guidelines.description'],
  ['legal', 'page_meta.acceptable_use.description'],
  ['legal', 'page_meta.legal_hub.description'],
  ['about', 'timebanking_guide.meta_description'],
  ['blog', 'page_description'],
];
const LOCALES = ['en', 'ga', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ja', 'ar'];

function value(locale: string, ns: string, key: string): unknown {
  let node: unknown = JSON.parse(readFileSync(`public/locales/${locale}/${ns}.json`, 'utf8'));
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return node;
}

describe('public page descriptions name the community', () => {
  it.each(KEYS)('%s:%s has {{name}} in every language', (ns, key) => {
    for (const locale of LOCALES) {
      const v = value(locale, ns, key);
      expect(typeof v, `${locale} ${ns}:${key}`).toBe('string');
      expect(v as string, `${locale} ${ns}:${key}`).toContain('{{name}}');
    }
  });

  it.each(KEYS)('%s:%s stays within 160 characters in English with a typical name', (ns, key) => {
    const rendered = String(value('en', ns, key)).replace('{{name}}', 'TimeBank Ireland');
    expect(rendered.length).toBeLessThanOrEqual(160);
  });
});
