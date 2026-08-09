// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

describe('session timeout source contract', () => {
  const timeoutSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'timeout-warning.js'),
    'utf8'
  );
  const baseTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'views', 'layouts', 'base.njk'),
    'utf8'
  );

  it('signs out through the CSRF-protected POST form instead of a GET navigation', () => {
    expect(timeoutSource).toContain('form="session-timeout-logout-form"');
    expect(timeoutSource).toContain('submitLogout();');
    expect(timeoutSource).not.toMatch(/href=["']\/logout/);
    expect(timeoutSource).not.toMatch(/window\.location\.href\s*=\s*["']\/logout/);

    expect(baseTemplate).toContain('id="session-timeout-logout-form"');
    expect(baseTemplate).toContain('method="post" action="{{ urlFor(\'/logout\') }}"');
    expect(baseTemplate).toContain('name="_csrf" value="{{ csrfToken }}"');
  });

  it('uses the tenant-aware rendered login URL when session extension fails', () => {
    expect(baseTemplate).toContain('data-login-url="{{ urlFor(\'/login\') }}"');
    expect(timeoutSource).toContain("getAttribute('data-login-url')");
  });
});
