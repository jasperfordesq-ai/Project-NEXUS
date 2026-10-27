// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The group gallery, challenges, channels and webhooks routers are reachable,
 * behind the CSRF check, and the gallery upload is parsed BEFORE that check
 * (the CSRF token travels inside the multipart body). Read from the source:
 * server.js cannot be required in a unit test without starting the app.
 */
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

describe('server.js mounts the group media routers', () => {
  const routers = {
    groupGalleryRoutes: './routes/group-gallery',
    groupChallengeRoutes: './routes/group-challenges',
    groupChannelRoutes: './routes/group-channels',
    groupWebhookRoutes: './routes/group-webhooks'
  };

  it.each(Object.entries(routers))('requires %s', (name, modulePath) => {
    expect(source).toContain(`const ${name} = require('${modulePath}');`);
  });

  it('mounts all four under /groups behind the CSRF check', () => {
    expect(source).toMatch(/app\.use\('\/groups', doubleCsrfProtection, groupGalleryRoutes, groupChallengeRoutes, groupChannelRoutes, groupWebhookRoutes\);/);
  });

  it('parses the gallery upload before the CSRF check runs', () => {
    const parser = source.indexOf("/^\\/groups\\/\\d+\\/gallery$/,\n  parseMultipartForm(");
    const mount = source.indexOf("app.use('/groups', doubleCsrfProtection, groupGalleryRoutes");
    expect(parser).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(parser);
    expect(source).toContain('groupGalleryRoutes.galleryMultipartErrorRedirect');
  });
});
