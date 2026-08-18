// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// The Content Security Policy in src/server.js sets script-src to 'self', one
// pinned sha256 hash, and the Turnstile host. There is no 'unsafe-inline', and
// the cspNonce that layouts/base.njk checks for is never set by any middleware.
//
// So ANY inline <script> body other than the one pinned hash, and ANY inline
// on* handler attribute, is silently dead in the browser: no error the member
// sees, no failing test, just a control that does nothing. Two shipped that way
// — the recurrence interval sync on events/new.njk (every "Every 2 weeks"
// series was created weekly) and the print button on the check-in credential
// page. This contract stops a third.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIEWS_DIRECTORY = path.join(__dirname, '..', 'src', 'views');
const SERVER_SOURCE = path.join(__dirname, '..', 'src', 'server.js');

// The single inline script the CSP pins by hash: the GOV.UK js-enabled flag in
// layouts/base.njk. It has to be inline — it must run before first paint.
const PINNED_INLINE_SCRIPT =
  "document.body.className += ' js-enabled' + ('noModule' in HTMLScriptElement.prototype ? ' govuk-frontend-supported' : '');";

// Non-executable data blocks. Browsers never run these, so the CSP is not in play.
const DATA_SCRIPT_TYPES = ['application/ld+json'];

function nunjucksFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return nunjucksFilesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function sha256Base64(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('base64');
}

describe('Content Security Policy inline-script contract', () => {
  it('pins the one inline script it allows, so that script cannot drift unnoticed', () => {
    const serverSource = fs.readFileSync(SERVER_SOURCE, 'utf8');
    const baseLayout = fs.readFileSync(path.join(VIEWS_DIRECTORY, 'layouts', 'base.njk'), 'utf8');

    // The allowed script must still be present in the layout verbatim...
    expect(baseLayout).toContain(PINNED_INLINE_SCRIPT);

    // ...and its hash must still be the one the CSP allows. Editing the script
    // without updating the hash would stop js-enabled being applied at all.
    expect(serverSource).toContain(`'sha256-${sha256Base64(PINNED_INLINE_SCRIPT)}'`);
  });

  it('keeps script-src free of unsafe-inline', () => {
    const serverSource = fs.readFileSync(SERVER_SOURCE, 'utf8');
    const scriptSrc = serverSource.match(/scriptSrc:\s*\[([^\]]*)\]/);

    expect(scriptSrc).not.toBeNull();
    expect(scriptSrc[1]).not.toContain('unsafe-inline');
  });

  it('has no inline script body that the CSP would block', () => {
    const violations = [];

    for (const templatePath of nunjucksFilesUnder(VIEWS_DIRECTORY)) {
      const source = fs.readFileSync(templatePath, 'utf8');

      for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const [, attributes, body] = match;

        // External files are served from 'self' (or an allowlisted host).
        if (/\bsrc\s*=/i.test(attributes)) continue;

        const typeAttribute = attributes.match(/\btype\s*=\s*(["'])(.*?)\1/i);
        if (typeAttribute && DATA_SCRIPT_TYPES.includes(typeAttribute[2].toLowerCase())) continue;

        if (body.trim() === PINNED_INLINE_SCRIPT) continue;

        violations.push(
          `${path.relative(VIEWS_DIRECTORY, templatePath)}:${lineNumberAt(source, match.index)}`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('has no inline event-handler attribute, which the CSP also blocks', () => {
    const violations = [];
    const handlerPattern =
      /\bon(?:click|change|submit|input|load|error|keyup|keydown|focus|blur|mouseover|mouseout)\s*=/gi;

    for (const templatePath of nunjucksFilesUnder(VIEWS_DIRECTORY)) {
      const source = fs.readFileSync(templatePath, 'utf8');

      for (const match of source.matchAll(handlerPattern)) {
        violations.push(
          `${path.relative(VIEWS_DIRECTORY, templatePath)}:${lineNumberAt(source, match.index)}`
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
