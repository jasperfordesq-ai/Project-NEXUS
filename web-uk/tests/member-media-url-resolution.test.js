// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The members directory printed the API's raw avatar path straight into the
 * `<img src>`:
 *
 *     avatar: String(member.avatar || member.avatar_url || ...).trim()
 *
 * A relative `/uploads/avatars/...` is resolved by the browser against the PAGE,
 * so every avatar was requested from the accessible host instead of the API host
 * and 404'd — reported on 2026-08-18 with all 19 members of hour-timebank showing
 * a broken image. It was the only route left doing this; every other route
 * already resolved through the shell helpers, which is why only this one page
 * was visibly broken.
 *
 * Fixed in 7760e8829. These tests pin the fix and the wider class: no route may
 * assign an image-URL field from a raw string.
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const routeFiles = fs.readdirSync(routesDir).filter((file) => file.endsWith('.js'));

// Property names that end up in an `src`/`href` attribute for an image. A raw
// String() here is the bug; a filename or alt text is not, so they stay out.
const IMAGE_URL_FIELDS = [
  'avatar',
  'avatarUrl',
  'avatar_url',
  'imageUrl',
  'image_url',
  'logoUrl',
  'photoUrl',
  'coverUrl',
  'listingImageUrl'
];

const rawAssignment = new RegExp(
  '^[ \\t]*(?:' + IMAGE_URL_FIELDS.join('|') + ')[ \\t]*:[ \\t]*String\\(',
  'm'
);

describe('member-content image URLs resolve against the API origin', () => {
  it('the members directory resolves avatars through resolveBackendMediaUrl', () => {
    const src = fs.readFileSync(path.join(routesDir, 'members.js'), 'utf8');
    expect(src).toContain('avatar: resolveBackendMediaUrl(');
    expect(src).not.toMatch(/avatar:\s*String\(/);
  });

  it.each(routeFiles)('%s never assigns an image URL from a raw string', (file) => {
    const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const match = src.match(rawAssignment);
    expect(match ? match[0].trim() : null).toBeNull();
  });
});
