// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Help Centre's structure (registry) and text (translation files) are
 * separate, so nothing at compile time stops them drifting apart. These tests
 * are that check: every guide in the registry has text in every language,
 * every text entry is reachable, switches name real features, and translated
 * bodies keep the same links, steps and lists as the English original.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_REGISTRY, isGateOpen } from './registry';
import { parseHelpBody } from './HelpBody';
import { HELP_AUDIENCES, HELP_AUDIENCE_NAMESPACE, type HelpGate } from './types';

const LOCALES_DIR = path.resolve(__dirname, '../../../../public/locales');
const LOCALES = fs.readdirSync(LOCALES_DIR).filter((entry) =>
  fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory(),
);

interface GuideFile {
  sections: Record<string, {
    title: string;
    summary: string;
    articles: Record<string, { title: string; summary: string; body: string }>;
  }>;
}

function readGuide(locale: string, namespace: string): GuideFile {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${namespace}.json`), 'utf8').replace(/^﻿/, ''));
}

function interfaceKeys(name: string): Set<string> {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../types/api.ts'), 'utf8');
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match) throw new Error(`interface ${name} not found`);
  return new Set([...match[1].matchAll(/^\s*([a-z_]+)\??:/gm)].map((m) => m[1]));
}

const FEATURES = interfaceKeys('TenantFeatures');
const MODULES = interfaceKeys('TenantModules');

function gateNames(gate: HelpGate | undefined): Array<{ kind: 'feature' | 'module'; name: string }> {
  if (!gate) return [];
  const terms = 'any' in gate ? gate.any : [gate];
  return terms.map((term) => ('feature' in term ? { kind: 'feature', name: term.feature } : { kind: 'module', name: term.module }));
}

/** The parts of a body a translation must keep: links, and the shape of lists and steps. */
function bodyShape(body: string) {
  return {
    links: [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort(),
    blocks: parseHelpBody(body).map((block) => `${block.kind}:${block.kind === 'step' || block.kind === 'bullet' ? block.lines.length : ''}`),
  };
}

describe.each(HELP_AUDIENCES)('%s guide', (audience) => {
  const namespace = HELP_AUDIENCE_NAMESPACE[audience];
  const registry = HELP_REGISTRY[audience];
  const english = readGuide('en', namespace);

  it('has at least one section', () => {
    expect(registry.length).toBeGreaterThan(0);
  });

  it('uses each section and article id once', () => {
    const sectionIds = registry.map((s) => s.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    for (const section of registry) {
      const articleIds = section.articles.map((a) => a.id);
      expect(new Set(articleIds).size, section.id).toBe(articleIds.length);
    }
  });

  it('has English text for every registered guide, and nothing unregistered', () => {
    expect(Object.keys(english.sections).sort()).toEqual(registry.map((s) => s.id).sort());
    for (const section of registry) {
      const text = english.sections[section.id];
      expect(text.title?.trim(), `${section.id}.title`).toBeTruthy();
      expect(text.summary?.trim(), `${section.id}.summary`).toBeTruthy();
      expect(Object.keys(text.articles).sort(), section.id).toEqual(section.articles.map((a) => a.id).sort());
      for (const article of section.articles) {
        const a = text.articles[article.id];
        expect(a.title?.trim(), `${section.id}.${article.id}.title`).toBeTruthy();
        expect(a.summary?.trim(), `${section.id}.${article.id}.summary`).toBeTruthy();
        expect(a.body?.trim(), `${section.id}.${article.id}.body`).toBeTruthy();
      }
    }
  });

  it('only depends on switches that exist', () => {
    for (const section of registry) {
      for (const entry of [section, ...section.articles]) {
        for (const { kind, name } of gateNames(entry.gate)) {
          expect((kind === 'feature' ? FEATURES : MODULES).has(name), `${entry.id}: ${kind} ${name}`).toBe(true);
        }
      }
    }
  });

  it('only links to pages inside the app', () => {
    for (const section of registry) {
      for (const article of section.articles) {
        const links = [
          ...(article.link ? [article.link] : []),
          ...bodyShape(english.sections[section.id].articles[article.id].body).links,
        ];
        for (const link of links) {
          expect(link.startsWith('/') && !link.startsWith('//'), `${section.id}.${article.id}: ${link}`).toBe(true);
        }
      }
    }
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('is fully translated into %s, keeping links and structure', (locale) => {
    const translated = readGuide(locale, namespace);
    expect(Object.keys(translated.sections).sort()).toEqual(Object.keys(english.sections).sort());
    for (const [sectionId, section] of Object.entries(english.sections)) {
      const other = translated.sections[sectionId];
      expect(other.title?.trim(), `${locale} ${sectionId}.title`).toBeTruthy();
      expect(other.summary?.trim(), `${locale} ${sectionId}.summary`).toBeTruthy();
      expect(Object.keys(other.articles).sort(), `${locale} ${sectionId}`).toEqual(Object.keys(section.articles).sort());
      for (const [articleId, article] of Object.entries(section.articles)) {
        const t = other.articles[articleId];
        const where = `${locale} ${sectionId}.${articleId}`;
        expect(t.title?.trim(), `${where}.title`).toBeTruthy();
        expect(t.summary?.trim(), `${where}.summary`).toBeTruthy();
        expect(t.body?.trim(), `${where}.body`).toBeTruthy();
        expect(bodyShape(t.body), where).toEqual(bodyShape(article.body));
      }
    }
  });
});

describe('isGateOpen', () => {
  const ctx = {
    hasFeature: (name: string) => name === 'events',
    hasModule: (name: string) => name === 'wallet',
  };

  it('is open for ungated entries', () => {
    expect(isGateOpen(null, ctx)).toBe(true);
    expect(isGateOpen(undefined, ctx)).toBe(true);
  });

  it('follows the feature or module switch', () => {
    expect(isGateOpen({ feature: 'events' }, ctx)).toBe(true);
    expect(isGateOpen({ feature: 'groups' }, ctx)).toBe(false);
    expect(isGateOpen({ module: 'wallet' }, ctx)).toBe(true);
    expect(isGateOpen({ module: 'feed' }, ctx)).toBe(false);
  });

  it('opens an any-gate when one switch is on', () => {
    expect(isGateOpen({ any: [{ feature: 'groups' }, { module: 'wallet' }] }, ctx)).toBe(true);
    expect(isGateOpen({ any: [{ feature: 'groups' }, { module: 'feed' }] }, ctx)).toBe(false);
  });
});
