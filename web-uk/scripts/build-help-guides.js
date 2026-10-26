// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Build this frontend's copy of the Help Centre guides.
 *
 * 🔴 ONE SOURCE, TWO FRONTENDS. The guides are written for the React Help Centre
 * (added 26 Sep 2026, reworded regularly since):
 *
 *   react-frontend/src/pages/help/guides/data/{members,brokers,admins}.registry.json
 *     which sections and articles exist, their order, the feature / module /
 *     setting each one depends on, and the app page each article is about;
 *   react-frontend/public/locales/<locale>/help_{members,brokers,admins}.json
 *     every title, summary and article body, in all eleven languages;
 *   react-frontend/public/locales/<locale>/help_centre.json
 *     the Help Centre's own headings ("Help Centre", "Browse by topic", ...).
 *
 * This frontend's Docker build context is `web-uk/`, so none of those files is in
 * its image — a runtime read would work in dev and throw in production. The copy is
 * generated and committed instead, exactly like features-catalogue.json, and
 * `--check` (plus tests/help-guides.test.js) fails the moment it no longer matches
 * React, so the accessible Help Centre cannot quietly fall behind.
 *
 * Output (src/lib/generated/help-guides/):
 *   structure.json   the three registries, plus every app path the guides link to
 *                    (registry `link` fields and `[text](/path)` links inside bodies,
 *                    in every language) so the link map can be checked for coverage;
 *   <locale>.json    the text, one file per language so a request loads only its own.
 *
 * A string missing from a language is filled from English here, as React's i18next
 * fallback does at runtime. A string missing from ENGLISH fails the build.
 *
 * Usage:
 *   node scripts/build-help-guides.js          # write the files
 *   node scripts/build-help-guides.js --check  # fail if they are out of date
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const reactRoot = path.join(repoRoot, 'react-frontend');
const registryRoot = path.join(reactRoot, 'src', 'pages', 'help', 'guides', 'data');
const localesRoot = path.join(reactRoot, 'public', 'locales');
const outputDir = path.join(__dirname, '..', 'src', 'lib', 'generated', 'help-guides');

// Listed rather than read from disk: a locale disappearing from react-frontend
// should fail here, not quietly shrink the accessible site's language coverage.
const LOCALES = Object.freeze(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']);

const AUDIENCES = Object.freeze(['members', 'brokers', 'admins']);
const AUDIENCE_NAMESPACE = Object.freeze({
  members: 'help_members',
  brokers: 'help_brokers',
  admins: 'help_admins'
});

// help_centre.json keys this frontend does not use: they label React's own broker
// and admin panels, which the accessible site does not have.
const CENTRE_EXCLUDED_KEYS = Object.freeze(['broker_panel', 'admin_panel']);

const BODY_LINK = /\[[^\]]+\]\(([^)\s]+)\)/g;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Keep only the parts of a gate this frontend evaluates; reject anything unknown. */
function normaliseGate(gate, where, problems) {
  if (gate === undefined || gate === null) return null;
  if (Array.isArray(gate.any)) return { any: gate.any.map((part) => normaliseGate(part, where, problems)) };
  if (Array.isArray(gate.all)) return { all: gate.all.map((part) => normaliseGate(part, where, problems)) };
  if (typeof gate.feature === 'string') return { feature: gate.feature };
  if (typeof gate.module === 'string') return { module: gate.module };
  if (typeof gate.setting === 'string') return { setting: gate.setting };
  problems.push(`${where}: unrecognised gate ${JSON.stringify(gate)}`);
  return null;
}

function readRegistries(problems) {
  const audiences = {};
  for (const audience of AUDIENCES) {
    const file = path.join(registryRoot, `${audience}.registry.json`);
    if (!fs.existsSync(file)) throw new Error(`Help registry not found at ${file}`);
    const sections = readJson(file);
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error(`Help registry ${audience} has no sections`);
    }
    audiences[audience] = sections.map((section) => ({
      id: section.id,
      gate: normaliseGate(section.gate, `${audience}.${section.id}`, problems),
      articles: (section.articles || []).map((article) => {
        const entry = { id: article.id };
        if (article.link) entry.link = article.link;
        const gate = normaliseGate(article.gate, `${audience}.${section.id}.${article.id}`, problems);
        if (gate) entry.gate = gate;
        if (article.popular) entry.popular = true;
        return entry;
      })
    }));
  }
  return audiences;
}

function pick(object, keys) {
  let value = object;
  for (const key of keys) {
    if (!value || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

function build() {
  const problems = [];
  const audiences = readRegistries(problems);
  const linkPaths = new Set();

  for (const audience of AUDIENCES) {
    for (const section of audiences[audience]) {
      for (const article of section.articles) if (article.link) linkPaths.add(article.link);
    }
  }

  const english = {};
  for (const audience of AUDIENCES) {
    english[audience] = readJson(path.join(localesRoot, 'en', `${AUDIENCE_NAMESPACE[audience]}.json`));
  }
  const englishCentre = readJson(path.join(localesRoot, 'en', 'help_centre.json'));

  const text = {};
  const fallbacks = {};
  let articleCount = 0;

  for (const locale of LOCALES) {
    const localeDir = path.join(localesRoot, locale);
    if (!fs.existsSync(localeDir)) {
      problems.push(`${locale}: locale directory missing`);
      continue;
    }
    fallbacks[locale] = 0;

    const readOptional = (file) => (fs.existsSync(file) ? readJson(file) : {});

    const centreSource = readOptional(path.join(localeDir, 'help_centre.json'));
    const centre = {};
    for (const key of Object.keys(englishCentre)) {
      if (CENTRE_EXCLUDED_KEYS.includes(key)) continue;
      if (centreSource[key] !== undefined) {
        centre[key] = centreSource[key];
      } else {
        centre[key] = englishCentre[key];
        fallbacks[locale] += 1;
      }
    }

    const guides = {};
    for (const audience of AUDIENCES) {
      const source = readOptional(path.join(localeDir, `${AUDIENCE_NAMESPACE[audience]}.json`));
      const value = (keys) => {
        const local = pick(source, keys);
        if (typeof local === 'string' && local !== '') return local;
        const fallback = pick(english[audience], keys);
        if (typeof fallback !== 'string' || fallback === '') {
          problems.push(`en: ${AUDIENCE_NAMESPACE[audience]}.${keys.join('.')} missing`);
          return '';
        }
        fallbacks[locale] += 1;
        return fallback;
      };

      const sections = {};
      for (const section of audiences[audience]) {
        const base = ['sections', section.id];
        const articles = {};
        for (const article of section.articles) {
          const articleBase = [...base, 'articles', article.id];
          const body = value([...articleBase, 'body']);
          for (const match of body.matchAll(BODY_LINK)) linkPaths.add(match[1]);
          articles[article.id] = {
            title: value([...articleBase, 'title']),
            summary: value([...articleBase, 'summary']),
            body
          };
          if (locale === 'en') articleCount += 1;
        }
        sections[section.id] = {
          title: value([...base, 'title']),
          summary: value([...base, 'summary']),
          articles
        };
      }
      guides[audience] = sections;
    }

    text[locale] = { centre, guides };
  }

  if (problems.length) {
    const shown = problems.slice(0, 20).join('\n  - ');
    const more = problems.length > 20 ? `\n  ...and ${problems.length - 20} more` : '';
    throw new Error(`Help guides are incomplete:\n  - ${shown}${more}`);
  }

  const counts = {};
  for (const audience of AUDIENCES) {
    counts[audience] = {
      sections: audiences[audience].length,
      articles: audiences[audience].reduce((n, s) => n + s.articles.length, 0)
    };
  }

  const structure = {
    _README:
      'GENERATED by web-uk/scripts/build-help-guides.js — do not edit by hand. '
      + 'Structure from react-frontend/src/pages/help/guides/data/*.registry.json; text from '
      + 'react-frontend/public/locales/<locale>/help_{members,brokers,admins,centre}.json. '
      + 'Refresh with `npm --prefix web-uk run build:help`; `npm --prefix web-uk run check:help` '
      + 'fails when these files are out of date.',
    locales: LOCALES,
    audiences: AUDIENCES,
    counts,
    linkPaths: [...linkPaths].sort(),
    registry: audiences
  };

  const files = { 'structure.json': serialise(structure) };
  for (const locale of LOCALES) {
    files[`${locale}.json`] = serialise({
      _README: `GENERATED by web-uk/scripts/build-help-guides.js from react-frontend (${locale}) — do not edit by hand.`,
      locale,
      englishFallbacks: fallbacks[locale],
      ...text[locale]
    });
  }

  return { files, counts, articleCount, fallbacks };
}

function serialise(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Names of generated files whose committed content differs from a fresh build. */
function staleFiles(files = build().files) {
  const stale = [];
  for (const [name, next] of Object.entries(files)) {
    const file = path.join(outputDir, name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== next) stale.push(name);
  }
  if (fs.existsSync(outputDir)) {
    for (const name of fs.readdirSync(outputDir)) {
      if (!Object.prototype.hasOwnProperty.call(files, name)) stale.push(name);
    }
  }
  return stale;
}

function summary(counts) {
  return AUDIENCES.map((a) => `${a} ${counts[a].sections} sections / ${counts[a].articles} articles`).join(', ');
}

function main() {
  const check = process.argv.includes('--check');
  const { files, counts } = build();

  if (check) {
    const stale = staleFiles(files);
    if (stale.length) {
      console.error(`FAIL: src/lib/generated/help-guides/ is out of date (${stale.join(', ')}).`);
      console.error('      Run `npm --prefix web-uk run build:help` and commit the result.');
      process.exit(1);
    }
    console.log(`Help guides up to date: ${summary(counts)}, ${LOCALES.length} locales.`);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of fs.readdirSync(outputDir)) {
    if (!Object.prototype.hasOwnProperty.call(files, name)) fs.unlinkSync(path.join(outputDir, name));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, name), content, 'utf8');
  }
  console.log(`Help guides written: ${summary(counts)}, ${LOCALES.length} locales.`);
}

module.exports = { build, staleFiles, LOCALES, AUDIENCES, outputDir };

if (require.main === module) main();
