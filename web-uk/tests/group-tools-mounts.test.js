// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The group Q&A, wiki, tasks and analytics routers must be mounted under /groups
 * behind the same CSRF check and form rate limit as the rest of the group pages,
 * and on the same line, so each POST is counted once by the limiter.
 *
 * server.js cannot be required in a unit test without starting the app, so this
 * reads its source.
 */
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

describe('server.js mounts the group tool routers', () => {
  it('requires all four routers', () => {
    for (const file of ['group-qa', 'group-wiki', 'group-tasks', 'group-analytics']) {
      expect(source).toContain(`require('./routes/${file}')`);
    }
  });

  it('mounts them with the groups router behind CSRF and the form limiter', () => {
    expect(source).toMatch(/app\.use\('\/groups', doubleCsrfProtection, postOnly\(formLimiter\), groupsRoutes, groupQaRoutes, groupWikiRoutes, groupTaskRoutes, groupAnalyticsRoutes\);/);
  });
});
