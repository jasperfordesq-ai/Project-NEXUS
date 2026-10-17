// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pure helpers for the landing page editor: cloning, stable list keys,
 * stripping empty values before save, normalising what the server returns,
 * telling "equal to the standard page" apart from "customised", and the
 * validation that blocks Save with a plain-English reason.
 */

import type {
  AudienceCard,
  LandingPageConfig,
  LandingSection,
  LandingSectionType,
  StatsContent,
} from '@/types/landing-page';
import { DEFAULT_LANDING_PAGE_CONFIG } from '@/types/landing-page';

/** Deep-clone a config to avoid mutation. */
export function cloneConfig(config: LandingPageConfig): LandingPageConfig {
  return JSON.parse(JSON.stringify(config)) as LandingPageConfig;
}

/** Monotonic client-only id source for stable list keys (never persisted). */
let listKeySeq = 0;
export function genListKey(): string {
  listKeySeq += 1;
  return `lpk-${listKeySeq}`;
}

/**
 * Inject a stable client-only `_key` into every content-array item that lacks one,
 * so React keys survive reorder/delete. cleanConfig() strips `_key` again before
 * save, so the persisted config never sees it.
 */
export function withListKeys(config: LandingPageConfig): LandingPageConfig {
  const next = cloneConfig(config);
  for (const section of next.sections) {
    if (!section.content) continue;
    const content = section.content as Record<string, unknown>;
    for (const key of Object.keys(content)) {
      const val = content[key];
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (item && typeof item === 'object' && !(item as Record<string, unknown>)._key) {
          (item as Record<string, unknown>)._key = genListKey();
        }
      }
    }
  }
  return next;
}

/** Sections sorted by their `order` value (what the public page does). */
export function sortedSections(sections: LandingSection[]): LandingSection[] {
  return [...sections].sort((a, b) => a.order - b.order);
}

/**
 * Strip empty values so the server only stores what the admin actually set.
 * Empty strings and all-empty list items go; the client-only `_key` goes; a
 * section whose content ends up empty loses its `content` key entirely.
 */
export function cleanConfig(config: LandingPageConfig): LandingPageConfig {
  const cleaned = cloneConfig(config);
  for (const section of cleaned.sections) {
    if (!section.content) continue;
    const content = section.content as Record<string, unknown>;
    for (const key of Object.keys(content)) {
      const val = content[key];
      if (val === '' || val === undefined || val === null) {
        delete content[key];
        continue;
      }
      if (Array.isArray(val)) {
        const filtered = (val as Record<string, unknown>[])
          .map((item) => {
            const rest = { ...item };
            delete rest._key;
            return rest;
          })
          .filter((item) =>
            Object.values(item).some((v) => v !== '' && v !== undefined && v !== null),
          );
        if (filtered.length === 0) {
          delete content[key];
        } else {
          content[key] = filtered;
        }
      }
    }
    if (Object.keys(content).length === 0) {
      delete section.content;
    }
  }
  return cleaned;
}

/**
 * What the server returned, made editable:
 *  - any standard section missing from the saved list is appended (hidden), so an
 *    older config never loses a block the editor knows about;
 *  - the stats block's inner `show_live_stats:false` becomes `enabled:false` — the
 *    editor offers one Shown switch, not two ways of hiding the same block;
 *  - `order` is renumbered 0..n so moves are simple swaps.
 */
export function normaliseLoadedConfig(config: LandingPageConfig): LandingPageConfig {
  const known = new Set(config.sections.map((s) => s.type));
  const sections: LandingSection[] = sortedSections(config.sections).map((s) => ({ ...s }));
  for (const def of DEFAULT_LANDING_PAGE_CONFIG.sections) {
    if (!known.has(def.type)) {
      sections.push({ ...cloneConfig({ sections: [def] }).sections[0]!, enabled: false });
    }
  }
  const renumbered = sections.map((section, index) => {
    const next: LandingSection = { ...section, order: index };
    if (next.type === 'stats' && next.content) {
      const stats = { ...(next.content as StatsContent) };
      if (stats.show_live_stats === false) {
        next.enabled = false;
      }
      delete stats.show_live_stats;
      next.content = Object.keys(stats).length > 0 ? stats : undefined;
      if (!next.content) delete next.content;
    }
    return next;
  });
  return withListKeys({ sections: renumbered });
}

/** The standard page, ready to edit. */
export function defaultConfig(): LandingPageConfig {
  return normaliseLoadedConfig(cloneConfig(DEFAULT_LANDING_PAGE_CONFIG));
}

/** Stable string for equality checks: cleaned, sorted by order, no client keys. */
export function configSignature(config: LandingPageConfig): string {
  const cleaned = cleanConfig(config);
  const sections = sortedSections(cleaned.sections).map((s, index) => ({
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    order: index,
    content: s.content ?? null,
  }));
  return JSON.stringify(sections);
}

/** True when the draft is the standard page: every block shown, standard order, no wording. */
export function isDefaultConfig(config: LandingPageConfig): boolean {
  return configSignature(config) === configSignature(defaultConfig());
}

/** True when the block carries any wording of its own (after cleaning). */
export function sectionHasCustomContent(section: LandingSection): boolean {
  const cleaned = cleanConfig({ sections: [section] }).sections[0];
  return Boolean(cleaned && cleaned.content && Object.keys(cleaned.content).length > 0);
}

/** A link the public page can follow: a path on this site or a full web address. */
export function isValidLandingLink(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return /^https?:\/\//i.test(trimmed);
}

export type ConfigProblem =
  | { kind: 'card_title'; sectionType: LandingSectionType; sectionId: string; number: number }
  | { kind: 'card_link'; sectionType: LandingSectionType; sectionId: string; number: number }
  | { kind: 'item_title'; sectionType: LandingSectionType; sectionId: string; number: number }
  | {
      kind: 'button_link';
      sectionType: LandingSectionType;
      sectionId: string;
      field: 'cta_primary_link' | 'cta_secondary_link' | 'button_link';
    };

/**
 * Everything that would make the public page render wrongly or the server refuse
 * the save. Checked on the cleaned draft, so an all-empty list item (a card the
 * admin added and never filled) is simply dropped rather than reported.
 */
export function findConfigProblems(config: LandingPageConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  for (const section of cleanConfig(config).sections) {
    const content = section.content as Record<string, unknown> | undefined;
    if (!content) continue;
    const base = { sectionType: section.type, sectionId: section.id };

    if (section.type === 'audience_cards') {
      const cards = (content.cards as AudienceCard[] | undefined) ?? [];
      cards.forEach((card, index) => {
        if (!card.title || card.title.trim() === '') {
          problems.push({ kind: 'card_title', ...base, number: index + 1 });
        }
        if (!isValidLandingLink(card.target_url ?? '')) {
          problems.push({ kind: 'card_link', ...base, number: index + 1 });
        }
      });
    }

    const listKey =
      section.type === 'feature_pills' ? 'items'
      : section.type === 'how_it_works' ? 'steps'
      : section.type === 'core_values' ? 'values'
      : null;
    if (listKey) {
      const items = (content[listKey] as Array<{ title?: string }> | undefined) ?? [];
      items.forEach((item, index) => {
        if (!item.title || item.title.trim() === '') {
          problems.push({ kind: 'item_title', ...base, number: index + 1 });
        }
      });
    }

    if (section.type === 'hero') {
      for (const field of ['cta_primary_link', 'cta_secondary_link'] as const) {
        const value = content[field];
        if (typeof value === 'string' && value !== '' && !isValidLandingLink(value)) {
          problems.push({ kind: 'button_link', ...base, field });
        }
      }
    }
    if (section.type === 'cta') {
      const value = content.button_link;
      if (typeof value === 'string' && value !== '' && !isValidLandingLink(value)) {
        problems.push({ kind: 'button_link', ...base, field: 'button_link' });
      }
    }
  }
  return problems;
}

/** Swap a section with its neighbour; returns the same array when at an end. */
export function moveSectionBy(
  sections: LandingSection[],
  id: string,
  direction: 'up' | 'down',
): LandingSection[] {
  const sorted = sortedSections(sections);
  const index = sorted.findIndex((s) => s.id === id);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= sorted.length) return sections;
  const current = sorted[index]!;
  const swap = sorted[swapIndex]!;
  sorted[index] = { ...swap, order: current.order };
  sorted[swapIndex] = { ...current, order: swap.order };
  return sorted;
}

/** Reorder by dragging: the section `id` lands where `overId` was. */
export function moveSectionTo(sections: LandingSection[], id: string, overId: string): LandingSection[] {
  const sorted = sortedSections(sections);
  const from = sorted.findIndex((s) => s.id === id);
  const to = sorted.findIndex((s) => s.id === overId);
  if (from === -1 || to === -1 || from === to) return sections;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved!);
  return sorted.map((s, index) => ({ ...s, order: index }));
}
