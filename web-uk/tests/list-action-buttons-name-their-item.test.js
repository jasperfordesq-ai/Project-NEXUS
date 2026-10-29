// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A list of items each with its own "Delete" (or Remove, Decline, Cancel…) button
 * reads to a screen reader as "Delete, Delete, Delete". GOV.UK adds the item's name
 * as visually hidden text. 21 such buttons had none until 29 Oct 2026.
 *
 * This scans single-line buttons and links inside `{% for %}` loops whose only
 * text is a translated destructive or editing verb. Two are allowed because the
 * context is already in the button's own disclosure summary or card title.
 */

const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const ALLOWED = new Set([
  'events/agenda.njk:govuk_alpha.events.agenda.confirm_cancel',
  'events/_registration-organizer-workflows.njk:event_registration.invitations.confirm_cancel'
]);

function templates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith('.njk') ? [full] : [];
  });
}

function bareButtons() {
  const found = [];
  for (const file of templates(VIEWS)) {
    const rel = path.relative(VIEWS, file).split(path.sep).join('/');
    let depth = 0;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
      depth += (line.match(/\{%-?\s*for\s/g) || []).length;
      if (depth > 0) {
        const re = /<(button|a)\b([^>]*)>\s*\{\{\s*t\(["']([^"']+)["']\)\s*\}\}\s*<\/\1>/g;
        for (const match of line.matchAll(re)) {
          const key = match[3];
          if (/aria-label/.test(match[2])) continue;
          if (!/(delete|remove|cancel|withdraw|decline|reject|revoke|edit|unblock|leave)\b/i.test(key.split('.').pop())) continue;
          if (!ALLOWED.has(`${rel}:${key}`)) found.push(`${rel}: ${key}`);
        }
      }
      depth = Math.max(0, depth - (line.match(/\{%-?\s*endfor\s*-?%\}/g) || []).length);
    });
  }
  return found;
}

it('every repeated delete/remove/cancel button in a list names its item', () => {
  expect(bareButtons()).toEqual([]);
});
