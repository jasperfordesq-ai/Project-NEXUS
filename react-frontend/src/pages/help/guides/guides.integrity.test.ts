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
import { HELP_REGISTRY, isGateOpen, visibleSections } from './registry';
import { parseHelpBody } from './HelpBody';
import { HELP_AUDIENCES, HELP_AUDIENCE_NAMESPACE, HELP_SETTINGS, type HelpGate } from './types';

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

/** A lookup the test requires; fails with a readable message instead of a crash. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function readGuide(locale: string, namespace: string): GuideFile {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${namespace}.json`), 'utf8').replace(/^﻿/, ''));
}

function interfaceKeys(name: string): Set<string> {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../types/api.ts'), 'utf8');
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match) throw new Error(`interface ${name} not found`);
  return new Set([...(match[1] ?? '').matchAll(/^\s*([a-z_]+)\??:/gm)].map((m) => m[1] ?? ''));
}

const FEATURES = interfaceKeys('TenantFeatures');
const MODULES = interfaceKeys('TenantModules');

const SETTINGS = new Set<string>(HELP_SETTINGS);

type GateKind = 'feature' | 'module' | 'setting';

function gateNames(gate: HelpGate | undefined): Array<{ kind: GateKind; name: string }> {
  if (!gate) return [];
  if ('any' in gate) return gate.any.flatMap(gateNames);
  if ('all' in gate) return gate.all.flatMap(gateNames);
  if ('feature' in gate) return [{ kind: 'feature', name: gate.feature }];
  if ('module' in gate) return [{ kind: 'module', name: gate.module }];
  return [{ kind: 'setting', name: gate.setting }];
}

const KNOWN: Record<GateKind, Set<string>> = { feature: FEATURES, module: MODULES, setting: SETTINGS };

/**
 * Switches a section/article is guaranteed to need: bare terms and `all` parts
 * count; an `any` gate guarantees none of its parts on its own.
 */
function requiredGates(gate: HelpGate | undefined): string[] {
  if (!gate) return [];
  if ('all' in gate) return gate.all.flatMap(requiredGates);
  if ('any' in gate) return gate.any.length === 1 ? requiredGates(gate.any[0]) : [];
  if ('feature' in gate) return [`feature:${gate.feature}`];
  if ('module' in gate) return [`module:${gate.module}`];
  return [`setting:${gate.setting}`];
}

/**
 * The member app's route table: path → the FeatureGate switches wrapping it.
 * Read from source so a guide cannot outlive a page being put behind a switch.
 */
function routeGates(): Array<{ pattern: RegExp; path: string; gates: string[] }> {
  const routes: Array<{ pattern: RegExp; path: string; gates: string[] }> = [];
  for (const file of ['AppRoutes.tsx', 'PublicAppRoutes.tsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../routes', file), 'utf8');
    for (const chunk of source.split(/(?=<Route\s)/)) {
      const route = /^<Route\s+path="([^"]+)"/.exec(chunk);
      if (!route) continue;
      const gates = [...chunk.matchAll(/<FeatureGate\s+(feature|module)="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
      const routePath = `/${(route[1] ?? '').replace(/^\//, '')}`;
      const pattern = new RegExp(`^${routePath.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')}$`);
      routes.push({ pattern, path: routePath, gates });
    }
  }
  return routes;
}

const ROUTE_GATES = routeGates();

function gatesForLink(link: string): string[] | null {
  const clean = link.split(/[?#]/)[0]?.replace(/(.)\/$/, '$1') ?? link;
  const exact = ROUTE_GATES.filter((r) => r.path === clean);
  const matches = exact.length > 0 ? exact : ROUTE_GATES.filter((r) => r.pattern.test(clean));
  if (matches.length === 0) return null;
  return [...new Set(matches.flatMap((r) => r.gates))];
}

/** The parts of a body a translation must keep: links, and the shape of lists and steps. */
function bodyShape(body: string) {
  return {
    links: [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? '').sort(),
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
      const text = required(english.sections[section.id], `English text for ${section.id}`);
      expect(text.title?.trim(), `${section.id}.title`).toBeTruthy();
      expect(text.summary?.trim(), `${section.id}.summary`).toBeTruthy();
      expect(Object.keys(text.articles).sort(), section.id).toEqual(section.articles.map((a) => a.id).sort());
      for (const article of section.articles) {
        const a = required(text.articles[article.id], `English text for ${section.id}.${article.id}`);
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
          expect(KNOWN[kind].has(name), `${entry.id}: ${kind} ${name}`).toBe(true);
        }
      }
    }
  });

  it('only links to pages inside the app', () => {
    for (const section of registry) {
      for (const article of section.articles) {
        const links = [
          ...(article.link ? [article.link] : []),
          ...bodyShape(english.sections[section.id]?.articles[article.id]?.body ?? '').links,
        ];
        for (const link of links) {
          expect(link.startsWith('/') && !link.startsWith('//'), `${section.id}.${article.id}: ${link}`).toBe(true);
        }
      }
    }
  });

  it('is hidden whenever a page it sends people to is switched off', () => {
    const problems: string[] = [];
    for (const section of registry) {
      for (const article of section.articles) {
        const have = new Set([...requiredGates(section.gate), ...requiredGates(article.gate)]);
        const links = [
          ...(article.link ? [article.link] : []),
          ...bodyShape(english.sections[section.id]?.articles[article.id]?.body ?? '').links,
        ].filter((link) => !/^\/(admin|broker|help|partners)(\/|$)/.test(link));
        for (const link of links) {
          const gates = gatesForLink(link);
          if (gates === null) {
            problems.push(`${section.id}.${article.id}: ${link} is not a page in the app`);
            continue;
          }
          for (const gate of gates) {
            if (!have.has(gate)) problems.push(`${section.id}.${article.id}: ${link} needs ${gate}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))('is fully translated into %s, keeping links and structure', (locale) => {
    const translated = readGuide(locale, namespace);
    expect(Object.keys(translated.sections).sort()).toEqual(Object.keys(english.sections).sort());
    for (const [sectionId, section] of Object.entries(english.sections)) {
      const other = required(translated.sections[sectionId], `${locale} ${sectionId}`);
      expect(other.title?.trim(), `${locale} ${sectionId}.title`).toBeTruthy();
      expect(other.summary?.trim(), `${locale} ${sectionId}.summary`).toBeTruthy();
      expect(Object.keys(other.articles).sort(), `${locale} ${sectionId}`).toEqual(Object.keys(section.articles).sort());
      for (const [articleId, article] of Object.entries(section.articles)) {
        const t = required(other.articles[articleId], `${locale} ${sectionId}.${articleId}`);
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
    hasSetting: (name: string) => name !== 'exchange_workflow',
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

  it('opens an all-gate only when every switch is on', () => {
    expect(isGateOpen({ all: [{ feature: 'events' }, { module: 'wallet' }] }, ctx)).toBe(true);
    expect(isGateOpen({ all: [{ feature: 'events' }, { module: 'feed' }] }, ctx)).toBe(false);
    expect(isGateOpen({ all: [{ module: 'wallet' }, { any: [{ feature: 'groups' }, { feature: 'events' }] }] }, ctx)).toBe(true);
  });

  it('follows a community setting', () => {
    expect(isGateOpen({ setting: 'exchange_workflow' }, ctx)).toBe(false);
    expect(isGateOpen({ all: [{ feature: 'events' }, { setting: 'exchange_workflow' }] }, ctx)).toBe(false);
  });

  it('hides the exchange guides when members cannot request exchanges', () => {
    const allOn = { hasFeature: () => true, hasModule: () => true, hasSetting: () => true };
    expect(visibleSections('members', allOn).map((s) => s.id)).toContain('exchanges');
    expect(visibleSections('members', { ...allOn, hasSetting: () => false }).map((s) => s.id)).not.toContain('exchanges');
  });

  it('hides account guides when the Settings page is switched off', () => {
    const settingsOff = { hasFeature: () => true, hasModule: (name: string) => name !== 'settings', hasSetting: () => true };
    const security = visibleSections('members', settingsOff).find((s) => s.id === 'security_signin');
    expect(security?.articles.map((a) => a.id)).not.toContain('changing_password');
  });
});
