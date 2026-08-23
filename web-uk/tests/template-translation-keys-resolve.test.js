// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');
const { catalogFor, valueInCatalog } = require('../src/lib/localization');

// 🔴 Why this matters more than it looks. `translate()` falls back to returning THE
// KEY ITSELF when nothing resolves, so a mistyped key does not throw, does not warn
// and does not render blank — it prints `events.is_online_label` on the page, to the
// member, in production. Nothing else in the suite would notice: the template still
// renders, the route still returns 200, and the accessibility gate still passes
// because the text exists and is readable. Only this check looks.
const VIEWS = path.join(__dirname, '..', 'src', 'views');

// A COMPLETE argument only. `t("events.poll_" + status)` is a deliberate
// concatenation and its literal half is a prefix, not a key — flagging those would
// make this test noise, and noise is how a check gets switched off.
const COMPLETE_KEY = /\b(?:t|tc)\(\s*["']([A-Za-z0-9_][A-Za-z0-9_.]*)["']\s*(?=[,)])/g;

function templates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith('.njk') ? [full] : [];
  });
}

describe('every literal translation key in a template resolves', () => {
  const english = catalogFor('en');

  it('finds no key that would render as raw text to a member', () => {
    const unresolved = [];
    let scanned = 0;
    for (const file of templates(VIEWS)) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = COMPLETE_KEY.exec(source))) {
        scanned += 1;
        if (typeof valueInCatalog(english, match[1]) !== 'string') {
          unresolved.push(`${path.relative(VIEWS, file)}: ${match[1]}`);
        }
      }
    }
    // Guards against the check quietly scanning nothing after a refactor.
    expect(scanned).toBeGreaterThan(7000);
    expect(unresolved).toEqual([]);
  });

  it('would actually catch a bad key', () => {
    // Proves the resolver call above can fail, rather than always returning a string.
    expect(valueInCatalog(english, 'events.is_online_label')).toEqual(expect.any(String));
    expect(valueInCatalog(english, 'events.no_such_key_anywhere')).toBeUndefined();
  });

  // 🔴 The honest limit: a key built at runtime is invisible here. `t("events.poll_"
  // + status)` resolves or does not depending on `status`, and no static check can
  // say which. Those concatenations are the remaining untested surface.
  it('records that concatenated keys are NOT covered', () => {
    const source = fs.readFileSync(path.join(VIEWS, 'events', 'detail.njk'), 'utf8');
    expect(source).toMatch(/t\(\s*["']events\.poll_["']/);
    expect([...source.matchAll(COMPLETE_KEY)].map((m) => m[1])).not.toContain('events.poll_');
  });
});
