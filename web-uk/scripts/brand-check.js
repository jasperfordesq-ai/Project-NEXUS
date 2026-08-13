#!/usr/bin/env node
/**
 * Branding Guard - Ensures no government branding exists in our templates
 *
 * This project is NOT a UK government service.
 * We must NOT use logos, branding, or imply government affiliation.
 *
 * Run: npm run brand:check
 */

const fs = require('fs');
const path = require('path');

// Patterns that are NEVER allowed (actual usage, not comments about them)
const FORBIDDEN_PATTERNS = [
  { pattern: /govukFooter\s*\(/g, description: 'govukFooter macro (includes crest by default)' },
  { pattern: /govukHeader\s*\(/g, description: 'govukHeader macro (includes crest by default)' },
  { pattern: /govuk-footer__copyright-logo/g, description: 'Copyright logo class' },
  { pattern: /<svg[^>]*crest/gi, description: 'Crest SVG element' },
  { pattern: /class="[^"]*\bogl\b[^"]*"/gi, description: 'OGL class' },
  { pattern: /Crown copyright/gi, description: 'Crown copyright wording' },
  { pattern: /Open Government Licence/gi, description: 'Open Government Licence wording' },
  { pattern: /GOV\.UK service/gi, description: 'Official GOV.UK service wording' },
];

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');

function isCommentLine(line) {
  const trimmed = line.trim();
  // Nunjucks comments: {# ... #}
  // Also check if line contains only comment content
  return trimmed.startsWith('{#') ||
         trimmed.endsWith('#}') ||
         (trimmed.includes('{#') && trimmed.includes('#}')) ||
         trimmed.startsWith('<!--') ||
         trimmed.startsWith('//') ||
         trimmed.startsWith('/*') ||
         trimmed.startsWith('*');
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const isComment = isCommentLine(line);

    // Skip comment lines entirely - we allow explanations of what we DON'T use
    if (isComment) {
      return;
    }

    // Check forbidden patterns in non-comment lines only
    FORBIDDEN_PATTERNS.forEach(({ pattern, description }) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          file: filePath,
          line: lineNum,
          description,
          content: line.trim()
        });
      }
    });
  });

  return violations;
}

function scanDirectory(dir) {
  let allViolations = [];

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      allViolations = allViolations.concat(scanDirectory(fullPath));
    } else if (item.name.endsWith('.njk') || item.name.endsWith('.html')) {
      allViolations = allViolations.concat(scanFile(fullPath));
    }
  }

  return allViolations;
}

console.log('Branding Guard - Checking for forbidden government branding...\n');

const violations = scanDirectory(VIEWS_DIR);

// 🔴 GDS Transport check — the compiled stylesheet, not the templates.
//
// The branding rules forbid the GDS Transport typeface outright: it is a licensed
// Crown font for GOV.UK services, and this is an independent community project.
// This guard scanned only `src/views`, so it could never have seen a font: on
// 2026-08-13 the compiled CSS named GDS Transport **63 TIMES** while this check
// reported "Branding check passed."
//
// It survived because nothing looked wrong — the font file is never served, so text
// fell back to arial. Blade sets `$govuk-font-family` and web-uk did not, letting
// govuk-frontend's default stack through.
//
// The fix is a `@use "govuk/index" as * with (...)` override in
// src/assets/scss/main.scss. This asserts the OUTPUT, because that is the thing that
// ships. If public/css/main.css is missing, that is not a pass — say so.
const CSS_BUILD = path.join(__dirname, '..', 'public', 'css', 'main.css');
if (!fs.existsSync(CSS_BUILD)) {
  console.error('BRANDING CHECK CANNOT RUN: public/css/main.css is missing.');
  console.error('Run `npm run build:css` first — a missing stylesheet is not a pass.');
  process.exit(1);
}
const compiledCss = fs.readFileSync(CSS_BUILD, 'utf8');
const gdsHits = (compiledCss.match(/GDS\s+Transport/gi) || []).length;
if (gdsHits > 0) {
  violations.push({
    file: CSS_BUILD,
    line: 0,
    description: `GDS Transport named ${gdsHits} time(s) in the compiled CSS — a licensed Crown typeface this project must not use. Add/restore the $govuk-font-family override in src/assets/scss/main.scss and rebuild.`,
    content: 'font-family: "GDS Transport", ...',
  });
}

// 🔴 The header "Not affiliated with GOV.UK" disclosure is no longer required,
// and this check no longer asserts it (owner decision, 2026-08-11). Laravel Blade
// — the source of truth for the browser experience — never carried it, and
// `govuk-frontend` is MIT: its licence requires the notice be retained, not a
// visible statement disclaiming affiliation.
//
// Everything above this comment still runs and must keep running. Those are the
// checks that actually protect the position: no `govukHeader`/`govukFooter`
// macro, no copyright-logo class, no crest SVG, no "Crown copyright" wording.
// Do NOT weaken them, and do not reinstate a disclosure assertion here without a
// new decision — a test now asserts the string stays ABSENT, so adding it back
// silently would fail.

if (violations.length > 0) {
  console.error('BRANDING VIOLATIONS FOUND:\n');

  violations.forEach(({ file, line, description, content }) => {
    const relativePath = path.relative(process.cwd(), file);
    console.error(`  ${relativePath}:${line}`);
    console.error(`    Issue: ${description}`);
    console.error(`    Content: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`);
    console.error('');
  });

  console.error(`\nFound ${violations.length} branding violation(s).`);
  console.error('This project is NOT a UK government service.');
  console.error('Remove all government branding and marks.\n');
  process.exit(1);
} else {
  console.log('No branding violations found.');
  console.log('  - No govukFooter macro usage');
  console.log('  - No govukHeader macro usage');
  console.log('  - No copyright logo classes');
  console.log('  - No crest SVG elements');
  console.log('  - No government copyright wording');
  console.log('\nBranding check passed.\n');
  process.exit(0);
}
