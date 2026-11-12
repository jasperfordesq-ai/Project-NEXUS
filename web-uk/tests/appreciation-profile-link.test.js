// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Thank-you notes (12 Nov 2026). Nothing on this site linked to the thank-you
 * notes page, so a member could only reach it — and the new "show on my
 * profile / hide / remove" controls on their own page — by typing the address.
 * The member profile now links to it, and only while the community has
 * thank-you notes switched on (a missing switch counts as on).
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const read = (file) => fs.readFileSync(path.join(src, file), 'utf8').replace(/\r\n/g, '\n');

describe('the member profile links to thank-you notes', () => {
  it('offers the link only when thank-you notes are switched on', () => {
    const profile = read('views/members/profile.njk');
    const link = /\{% if appreciationsEnabled %\}<p class="govuk-body"><a class="govuk-link"[^>]*href="\{\{ urlFor\('\/users\/' \+ \(user\.id \| string\) \+ '\/appreciations'\) \}\}">\{\{ t\("govuk_alpha_saved\.wall\.title"\) \}\}<\/a><\/p>\{% endif %\}/;
    expect(profile).toMatch(link);
    // Exactly one link to the page, and it is the guarded one.
    expect(profile.match(/\/appreciations'\)/g)).toHaveLength(1);
  });

  it('reads the switch from the community settings, on unless switched off', () => {
    const route = read('routes/members.js');
    expect(route).toContain("appreciationsEnabled: flagEnabled(tenant, 'appreciations', 'features', true)");
  });
});
