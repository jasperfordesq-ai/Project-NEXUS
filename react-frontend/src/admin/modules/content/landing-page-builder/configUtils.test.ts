// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import type { LandingPageConfig, LandingSection } from '@/types/landing-page';
import { DEFAULT_LANDING_PAGE_CONFIG } from '@/types/landing-page';
import {
  cleanConfig,
  configSignature,
  defaultConfig,
  findConfigProblems,
  isDefaultConfig,
  isValidLandingLink,
  moveSectionBy,
  moveSectionTo,
  normaliseLoadedConfig,
  sectionHasCustomContent,
  sortedSections,
} from './configUtils';

const section = (overrides: Partial<LandingSection> & Pick<LandingSection, 'id' | 'type'>): LandingSection => ({
  enabled: true,
  order: 0,
  ...overrides,
});

describe('cleanConfig', () => {
  it('drops empty strings, client keys and all-empty list items, and the content key when nothing is left', () => {
    const config: LandingPageConfig = {
      sections: [
        section({ id: 'hero', type: 'hero', content: { headline_1: '', badge_text: 'Hi' } }),
        section({
          id: 'how_it_works',
          type: 'how_it_works',
          order: 1,
          content: { steps: [{ _key: 'k1', title: '', description: '' }, { _key: 'k2', title: 'Step', description: '' }] },
        }),
        section({ id: 'cta', type: 'cta', order: 2, content: { title: '' } }),
      ],
    };
    const cleaned = cleanConfig(config);
    expect(cleaned.sections[0]!.content).toEqual({ badge_text: 'Hi' });
    expect(cleaned.sections[1]!.content).toEqual({ steps: [{ title: 'Step', description: '' }] });
    expect(cleaned.sections[2]!.content).toBeUndefined();
    // The draft itself is untouched.
    expect((config.sections[1]!.content as { steps: unknown[] }).steps).toHaveLength(2);
  });
});

describe('normaliseLoadedConfig', () => {
  it('folds the stats block\'s show_live_stats:false into enabled:false and renumbers order', () => {
    const loaded = normaliseLoadedConfig({
      sections: [
        section({ id: 'stats', type: 'stats', order: 10, enabled: true, content: { show_live_stats: false } }),
        section({ id: 'hero', type: 'hero', order: 3 }),
      ],
    });
    const ids = sortedSections(loaded.sections).map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual(['hero', 'stats']);
    const stats = loaded.sections.find((s) => s.id === 'stats')!;
    expect(stats.enabled).toBe(false);
    expect(stats.content).toBeUndefined();
    expect(loaded.sections.map((s) => s.order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('appends standard blocks missing from an older saved config, hidden', () => {
    const loaded = normaliseLoadedConfig({ sections: [section({ id: 'hero', type: 'hero' })] });
    expect(loaded.sections).toHaveLength(DEFAULT_LANDING_PAGE_CONFIG.sections.length);
    const cta = loaded.sections.find((s) => s.type === 'cta')!;
    expect(cta.enabled).toBe(false);
  });

  it('gives every list item a client key', () => {
    const loaded = normaliseLoadedConfig({
      sections: [section({ id: 'core_values', type: 'core_values', content: { values: [{ title: 'A', description: 'B' }] } })],
    });
    const values = (loaded.sections.find((s) => s.type === 'core_values')!.content as { values: { _key?: string }[] }).values;
    expect(values[0]!._key).toMatch(/^lpk-/);
  });
});

describe('isDefaultConfig / configSignature', () => {
  it('treats the untouched standard page as default, and a hidden block as not', () => {
    const draft = defaultConfig();
    expect(isDefaultConfig(draft)).toBe(true);
    const hidden = { sections: draft.sections.map((s) => (s.type === 'cta' ? { ...s, enabled: false } : s)) };
    expect(isDefaultConfig(hidden)).toBe(false);
  });

  it('ignores whitespace-only... no: treats empty strings as absent, so typing and clearing is not a change', () => {
    const draft = defaultConfig();
    const typedAndCleared = {
      sections: draft.sections.map((s) => (s.type === 'hero' ? { ...s, content: { headline_1: '' } } : s)),
    };
    expect(configSignature(typedAndCleared)).toBe(configSignature(draft));
  });

  it('ignores the absolute order values and compares the sequence', () => {
    const a = defaultConfig();
    const b = { sections: a.sections.map((s) => ({ ...s, order: s.order * 10 })) };
    expect(configSignature(a)).toBe(configSignature(b));
  });
});

describe('sectionHasCustomContent', () => {
  it('is false for empty wording and true once a value is set', () => {
    expect(sectionHasCustomContent(section({ id: 'hero', type: 'hero', content: { headline_1: '' } }))).toBe(false);
    expect(sectionHasCustomContent(section({ id: 'hero', type: 'hero', content: { headline_1: 'Hello' } }))).toBe(true);
  });
});

describe('isValidLandingLink', () => {
  it('accepts a site path or a full web address only', () => {
    expect(isValidLandingLink('/about')).toBe(true);
    expect(isValidLandingLink('https://example.org/x')).toBe(true);
    expect(isValidLandingLink('HTTP://example.org')).toBe(true);
    expect(isValidLandingLink('about')).toBe(false);
    expect(isValidLandingLink('//evil.example')).toBe(false);
    expect(isValidLandingLink('javascript:alert(1)')).toBe(false);
    expect(isValidLandingLink('')).toBe(false);
  });
});

describe('findConfigProblems', () => {
  it('names the card, step and button problems the server or the page would choke on', () => {
    const problems = findConfigProblems({
      sections: [
        section({
          id: 'audience_cards',
          type: 'audience_cards',
          content: {
            cards: [
              { title: '', description: 'x', cta_label: 'Go', target_url: '/a' },
              { title: 'Ok', description: '', cta_label: 'Go', target_url: 'nowhere' },
            ],
          },
        }),
        section({ id: 'how_it_works', type: 'how_it_works', order: 1, content: { steps: [{ title: ' ', description: 'd' }] } }),
        section({ id: 'hero', type: 'hero', order: 2, content: { cta_primary_link: 'register' } }),
        section({ id: 'cta', type: 'cta', order: 3, content: { button_link: '/register' } }),
      ],
    });
    expect(problems).toEqual([
      { kind: 'card_title', sectionType: 'audience_cards', sectionId: 'audience_cards', number: 1 },
      { kind: 'card_link', sectionType: 'audience_cards', sectionId: 'audience_cards', number: 2 },
      { kind: 'item_title', sectionType: 'how_it_works', sectionId: 'how_it_works', number: 1 },
      { kind: 'button_link', sectionType: 'hero', sectionId: 'hero', field: 'cta_primary_link' },
    ]);
  });

  it('ignores an all-empty item, which cleanConfig drops anyway', () => {
    const problems = findConfigProblems({
      sections: [section({ id: 'core_values', type: 'core_values', content: { values: [{ title: '', description: '' }] } })],
    });
    expect(problems).toEqual([]);
  });
});

describe('moveSectionBy / moveSectionTo', () => {
  const three = [
    section({ id: 'a', type: 'hero', order: 0 }),
    section({ id: 'b', type: 'stats', order: 1 }),
    section({ id: 'c', type: 'cta', order: 2 }),
  ];

  it('swaps with the neighbour and refuses to move past an end', () => {
    expect(sortedSections(moveSectionBy(three, 'b', 'up')).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(sortedSections(moveSectionBy(three, 'c', 'down')).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a dragged section where the target was', () => {
    expect(sortedSections(moveSectionTo(three, 'a', 'c')).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(sortedSections(moveSectionTo(three, 'c', 'a')).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });
});
