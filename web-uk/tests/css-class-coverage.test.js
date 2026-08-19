// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// 🔴 37 of this service's own CSS classes were referenced by 73 templates and
// defined by nothing. A class with no rule does not error — it silently falls
// back to browser defaults — so the members directory stacked vertically,
// threaded replies lost their indentation, the reaction you had picked had no
// visible marking, and long-form articles rendered in browser-default type.
// Nothing failed; the pages just looked wrong, on and off, for a long time.
//
// This test makes that class of fault a build failure. It reads the COMPILED
// stylesheet, so it also catches a rule that exists in Sass but never reaches
// the browser (a block commented out, or nested somewhere it does not emit).

const fs = require('fs');
const path = require('path');

const VIEWS_DIRECTORY = path.join(__dirname, '..', 'src', 'views');
const COMPILED_CSS = path.join(__dirname, '..', 'public', 'css', 'main.css');

// Prefixes this service owns. govuk-* comes from the vendor stylesheet and is
// out of scope; app-* is the abandoned system being retired separately.
const OWNED_PREFIXES = ['nexus-alpha', 'nexus-score'];
const OWNED_EXACT = ['legal-content'];

function nunjucksFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return nunjucksFilesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

function isOwnedClass(name) {
  return OWNED_EXACT.includes(name) || OWNED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function classesReferencedByTemplates() {
  const references = new Map();

  for (const templatePath of nunjucksFilesUnder(VIEWS_DIRECTORY)) {
    const source = fs.readFileSync(templatePath, 'utf8');
    const relativePath = path.relative(VIEWS_DIRECTORY, templatePath);

    // Both plain class="..." and the classes: "..." parameter GOV.UK macros take.
    for (const match of source.matchAll(/(?:class\s*=\s*|classes\s*:\s*)(["'])([\s\S]*?)\1/g)) {
      // Strip {% ... %} and {{ ... }} first. A conditional class sits inside the
      // same quoted attribute, and without this the class name adjacent to a tag
      // is read as part of that tag and missed — which is how the two "active
      // state" classes escaped the original sweep.
      const cleaned = match[2].replace(/\{[%{][\s\S]*?[%}]\}/g, ' ');

      for (const rawToken of cleaned.split(/\s+/)) {
        const token = rawToken.trim();
        if (!token || /[{}()"']/.test(token)) continue;
        // A trailing -- means the suffix is interpolated (logo--{{ shape }});
        // the concrete variants are asserted by their own usages.
        if (token.endsWith('--')) continue;
        if (!isOwnedClass(token)) continue;

        if (!references.has(token)) references.set(token, new Set());
        references.get(token).add(relativePath);
      }
    }
  }

  return references;
}

function classesDefinedInCompiledCss() {
  const css = fs.readFileSync(COMPILED_CSS, 'utf8');
  const defined = new Set();
  for (const match of css.matchAll(/\.([A-Za-z0-9_-]+)/g)) defined.add(match[1]);
  return defined;
}

describe('CSS class coverage', () => {
  it('has a compiled rule for every class this service uses in a template', () => {
    const references = classesReferencedByTemplates();
    const defined = classesDefinedInCompiledCss();

    const undefinedClasses = [...references.entries()]
      .filter(([name]) => !defined.has(name))
      .sort((a, b) => b[1].size - a[1].size)
      .map(([name, files]) => `${name} (${files.size} templates, e.g. ${[...files][0]})`);

    expect(undefinedClasses).toEqual([]);
  });

  it('actually finds classes to check, so it cannot pass by matching nothing', () => {
    const references = classesReferencedByTemplates();

    // Guards against a future refactor breaking the extraction and leaving this
    // suite green while checking an empty set.
    expect(references.size).toBeGreaterThan(50);
    expect(references.has('nexus-alpha-inline-list')).toBe(true);
    expect(references.has('nexus-alpha-reaction--active')).toBe(true);
  });

  it('contains no leaked Sass helper calls, which browsers silently discard', () => {
    // 🔴 govuk-tint()/govuk-shade() were removed in govuk-frontend 6. Sass emits
    // an unknown function verbatim as literal CSS, the browser drops the whole
    // declaration, and nothing fails — the legal-diff backgrounds and a warning
    // hover shipped dead this way. Any govuk-*() call surviving into the
    // compiled stylesheet is a build fault. (CSS custom properties are var()
    // references, not govuk-*() calls, so this cannot false-positive on them.)
    const css = fs.readFileSync(COMPILED_CSS, 'utf8');
    const leaked = css.match(/govuk-[a-z-]+\(/g) || [];
    expect(leaked).toEqual([]);
  });
});
