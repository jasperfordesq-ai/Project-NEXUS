// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The members' Help Centre guides, read inside the app.
 *
 * The website's Help Centre is two halves: a registry (section/article order, and
 * which community switch each depends on) compiled into the web bundle, and the
 * text, served as ordinary static files at `<APP_URL>/locales/<lang>/help_members.json`.
 * The app bundles a COPY of the registry (`membersRegistry.json`, kept identical to
 * `react-frontend/src/pages/help/guides/data/members.registry.json` by
 * `guides.test.ts`) and fetches the text, so a guide edited on the website is
 * edited here too, in every language, without an app release.
 *
 * 🔴 Only the members' guide. The broker and admin guides describe the Broker
 * Panel and admin panel, which exist only on the website.
 *
 * 🔴 Article bodies use the Help Centre's tiny format (paragraphs, `## ` headings,
 * `- ` bullets, `1. ` steps, `> ` tips, `**bold**`, `[text](/path)`). It is parsed
 * here into plain blocks and rendered as native Text — never as HTML. Links point
 * at WEBSITE paths, which are not app routes, so only their text is shown.
 */

import { APP_URL } from '@/lib/constants';
import registryJson from './membersRegistry.json';

export type HelpGateTerm = { feature: string } | { module: string };
export type HelpGate = HelpGateTerm | { any: HelpGateTerm[] } | null;

export interface HelpArticleEntry {
  id: string;
  link?: string;
  gate?: HelpGate;
  popular?: boolean;
}

export interface HelpSectionEntry {
  id: string;
  icon: string;
  gate?: HelpGate;
  articles: HelpArticleEntry[];
}

export interface HelpArticleText {
  title: string;
  summary: string;
  body: string;
}

export interface HelpSectionText {
  title: string;
  summary: string;
  articles: Record<string, HelpArticleText>;
}

export interface HelpGuideText {
  sections: Record<string, HelpSectionText>;
}

export interface HelpGateContext {
  hasFeature: (name: string) => boolean;
  hasModule: (name: string) => boolean;
}

export const MEMBERS_REGISTRY = registryJson as HelpSectionEntry[];

function termIsOpen(term: HelpGateTerm, ctx: HelpGateContext): boolean {
  return 'feature' in term ? ctx.hasFeature(term.feature) : ctx.hasModule(term.module);
}

export function isGateOpen(gate: HelpGate | undefined, ctx: HelpGateContext): boolean {
  if (!gate) return true;
  if ('any' in gate) return gate.any.some((term) => termIsOpen(term, ctx));
  return termIsOpen(gate, ctx);
}

/** Sections (and their articles) this community has switched on, in display order. */
export function visibleSections(ctx: HelpGateContext): HelpSectionEntry[] {
  return MEMBERS_REGISTRY
    .filter((section) => isGateOpen(section.gate, ctx))
    .map((section) => ({ ...section, articles: section.articles.filter((a) => isGateOpen(a.gate, ctx)) }))
    .filter((section) => section.articles.length > 0);
}

function guideUrl(language: string): string {
  return `${APP_URL.replace(/\/+$/, '')}/locales/${encodeURIComponent(language)}/help_members.json`;
}

function isGuideText(value: unknown): value is HelpGuideText {
  return !!value && typeof value === 'object' && !!(value as HelpGuideText).sections
    && typeof (value as HelpGuideText).sections === 'object';
}

async function fetchGuide(language: string): Promise<HelpGuideText | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(guideUrl(language), { signal: controller.signal });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return isGuideText(json) ? json : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The guide text in the member's language, falling back to English when that
 * language has no guide yet. Throws only when even English cannot be loaded.
 */
export async function getMembersGuide(language: string): Promise<HelpGuideText> {
  const base = (language || 'en').split('-')[0].toLowerCase();
  if (base !== 'en') {
    const translated = await fetchGuide(base).catch(() => null);
    if (translated) return translated;
  }
  const english = await fetchGuide('en');
  if (!english) throw new Error('help guide unavailable');
  return english;
}

export type HelpBlock =
  | { kind: 'text' | 'heading' | 'tip'; lines: string[] }
  | { kind: 'bullet' | 'step'; lines: string[] };

type LineKind = HelpBlock['kind'] | 'blank';

function classify(line: string): LineKind {
  if (line.trim() === '') return 'blank';
  if (/^##\s+/.test(line)) return 'heading';
  if (/^\s*[-•]\s+/.test(line)) return 'bullet';
  if (/^\s*\d+[.)]\s+/.test(line)) return 'step';
  if (/^\s*>\s?/.test(line)) return 'tip';
  return 'text';
}

function stripMarker(kind: HelpBlock['kind'], line: string): string {
  switch (kind) {
    case 'heading': return line.replace(/^##\s+/, '');
    case 'bullet': return line.replace(/^\s*[-•]\s+/, '');
    case 'step': return line.replace(/^\s*\d+[.)]\s+/, '');
    case 'tip': return line.replace(/^\s*>\s?/, '');
    default: return line.trim();
  }
}

/** Same grouping rules as the website's `parseHelpBody`. */
export function parseHelpBody(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  let current: HelpBlock | null = null;
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const kind = classify(raw);
    if (kind === 'blank') {
      current = null;
      continue;
    }
    if (current && current.kind === kind && kind !== 'heading') {
      current.lines.push(stripMarker(kind, raw));
      continue;
    }
    current = { kind, lines: [stripMarker(kind, raw)] } as HelpBlock;
    blocks.push(current);
  }
  return blocks;
}

export interface InlinePart {
  text: string;
  bold: boolean;
}

/** Splits `**bold**` from plain text; `[text](/path)` becomes just `text`. */
export function parseInline(line: string): InlinePart[] {
  const withoutLinks = line.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
  return withoutLinks
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      return bold ? { text: bold[1] ?? '', bold: true } : { text: part, bold: false };
    });
}

/** Plain text of a body, for search. */
export function bodyToPlainText(body: string): string {
  return parseHelpBody(body)
    .flatMap((block) => block.lines)
    .map((line) => parseInline(line).map((part) => part.text).join(''))
    .join(' ');
}
