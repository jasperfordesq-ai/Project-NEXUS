// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import membersRegistry from './data/members.registry.json';
import brokersRegistry from './data/brokers.registry.json';
import adminsRegistry from './data/admins.registry.json';
import type {
  HelpArticleEntry,
  HelpAudience,
  HelpGate,
  HelpGateContext,
  HelpGateTerm,
  HelpSectionEntry,
} from './types';

export const HELP_REGISTRY: Record<HelpAudience, HelpSectionEntry[]> = {
  members: membersRegistry as HelpSectionEntry[],
  brokers: brokersRegistry as HelpSectionEntry[],
  admins: adminsRegistry as HelpSectionEntry[],
};

function termIsOpen(term: HelpGateTerm, ctx: HelpGateContext): boolean {
  if ('feature' in term) return ctx.hasFeature(term.feature);
  return ctx.hasModule(term.module);
}

/** Whether a section/article switched on by `gate` exists in this community. */
export function isGateOpen(gate: HelpGate | undefined, ctx: HelpGateContext): boolean {
  if (!gate) return true;
  if ('any' in gate) return gate.any.some((term) => termIsOpen(term, ctx));
  return termIsOpen(gate, ctx);
}

export interface VisibleSection extends HelpSectionEntry {
  articles: HelpArticleEntry[];
}

/** Sections (and their articles) this community actually has, in display order. */
export function visibleSections(audience: HelpAudience, ctx: HelpGateContext): VisibleSection[] {
  return HELP_REGISTRY[audience]
    .filter((section) => isGateOpen(section.gate, ctx))
    .map((section) => ({
      ...section,
      articles: section.articles.filter((article) => isGateOpen(article.gate, ctx)),
    }))
    .filter((section) => section.articles.length > 0);
}

export function sectionKey(sectionId: string, field: 'title' | 'summary'): string {
  return `sections.${sectionId}.${field}`;
}

export function articleKey(sectionId: string, articleId: string, field: 'title' | 'summary' | 'body'): string {
  return `sections.${sectionId}.articles.${articleId}.${field}`;
}

export function helpPath(audience: HelpAudience, sectionId?: string, articleId?: string): string {
  const parts = ['/help', audience];
  if (sectionId) parts.push(sectionId);
  if (articleId) parts.push(articleId);
  return parts.join('/');
}
