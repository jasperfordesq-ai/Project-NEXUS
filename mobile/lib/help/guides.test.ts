// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';

import {
  MEMBERS_REGISTRY,
  bodyToPlainText,
  getMembersGuide,
  isGateOpen,
  parseHelpBody,
  parseInline,
  visibleSections,
} from './guides';

const WEB_DATA = path.resolve(__dirname, '../../../react-frontend/src/pages/help/guides/data/members.registry.json');
const WEB_TEXT = path.resolve(__dirname, '../../../react-frontend/public/locales/en/help_members.json');

describe('members guide registry', () => {
  /*
    🔴 The app bundles a copy of the website's registry. If the website adds, moves or
    re-gates a guide and this copy is not refreshed, the app shows the wrong topics.
    Refresh with: cp react-frontend/src/pages/help/guides/data/members.registry.json mobile/lib/help/membersRegistry.json
  */
  it('is identical to the website registry', () => {
    const web = JSON.parse(fs.readFileSync(WEB_DATA, 'utf8'));
    expect(MEMBERS_REGISTRY).toEqual(web);
  });

  it('matches every section and article in the English guide text', () => {
    const text = JSON.parse(fs.readFileSync(WEB_TEXT, 'utf8'));
    expect(MEMBERS_REGISTRY.map((s) => s.id)).toEqual(Object.keys(text.sections));
    for (const section of MEMBERS_REGISTRY) {
      expect(section.articles.map((a) => a.id)).toEqual(Object.keys(text.sections[section.id].articles));
    }
  });
});

describe('gating', () => {
  const ctx = { hasFeature: (name: string) => name === 'events', hasModule: (name: string) => name === 'wallet' };

  it('follows feature, module and any-of switches', () => {
    expect(isGateOpen(null, ctx)).toBe(true);
    expect(isGateOpen({ feature: 'events' }, ctx)).toBe(true);
    expect(isGateOpen({ feature: 'groups' }, ctx)).toBe(false);
    expect(isGateOpen({ module: 'wallet' }, ctx)).toBe(true);
    expect(isGateOpen({ any: [{ feature: 'groups' }, { module: 'wallet' }] }, ctx)).toBe(true);
  });

  it('hides switched-off topics and articles', () => {
    const noneOn = visibleSections({ hasFeature: () => false, hasModule: () => false }).map((s) => s.id);
    const allOn = visibleSections({ hasFeature: () => true, hasModule: () => true }).map((s) => s.id);
    expect(noneOn).toContain('getting_started');
    expect(noneOn).not.toContain('events');
    expect(allOn).toContain('events');
  });
});

describe('body format', () => {
  it('groups lines like the website renderer', () => {
    const blocks = parseHelpBody('Intro.\n\n## Steps\n1. One\n2. Two\n\n- A\n- B\n\n> Tip here');
    expect(blocks.map((b) => [b.kind, b.lines.length])).toEqual([
      ['text', 1], ['heading', 1], ['step', 2], ['bullet', 2], ['tip', 1],
    ]);
    expect(blocks[2]?.lines).toEqual(['One', 'Two']);
  });

  it('keeps bold labels and shows only the text of website links', () => {
    expect(parseInline('Press **Send** on [your wallet](/wallet).')).toEqual([
      { text: 'Press ', bold: false },
      { text: 'Send', bold: true },
      { text: ' on your wallet.', bold: false },
    ]);
    expect(bodyToPlainText('1. Open [the wallet](/wallet)\n2. Press **Send**')).toBe('Open the wallet Press Send');
  });
});

describe('getMembersGuide', () => {
  const english = { sections: { a: { title: 'A', summary: 's', articles: {} } } };
  const german = { sections: { a: { title: 'Ä', summary: 's', articles: {} } } };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(files: Record<string, unknown>) {
    global.fetch = jest.fn(async (url: string) => {
      const lang = /\/locales\/([^/]+)\/help_members\.json$/.exec(String(url))?.[1] ?? '';
      const body = files[lang];
      return { ok: !!body, json: async () => body } as Response;
    }) as unknown as typeof fetch;
  }

  it('reads the guide in the member\'s language from the website\'s static files', async () => {
    mockFetch({ de: german, en: english });
    await expect(getMembersGuide('de-DE')).resolves.toEqual(german);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch(/\/locales\/de\/help_members\.json$/);
  });

  it('falls back to English when the language has no guide', async () => {
    mockFetch({ en: english });
    await expect(getMembersGuide('ga')).resolves.toEqual(english);
  });

  it('fails when even English cannot be loaded', async () => {
    mockFetch({});
    await expect(getMembersGuide('en')).rejects.toThrow();
  });
});
