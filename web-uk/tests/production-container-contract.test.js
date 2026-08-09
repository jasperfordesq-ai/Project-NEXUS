// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

describe('production container source contract', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

  it('supports a digest-pinned shared Node base image', () => {
    expect(dockerfile).toContain('ARG NODE_IMAGE=node:20-alpine');
    expect(dockerfile.match(/^FROM \$\{NODE_IMAGE\}/gm)).toHaveLength(2);
    expect(dockerfile).not.toMatch(/^FROM node:/m);
  });

  it('installs exactly the locked dependency graph in every image stage', () => {
    expect(dockerfile.match(/RUN npm ci --no-audit --no-fund/g)).toHaveLength(2);
    expect(dockerfile).toContain(
      'RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force'
    );
    expect(dockerfile).not.toMatch(/RUN npm install(?:\s|$)/);
  });

  it('runs production as a non-root user with a readiness health check', () => {
    expect(dockerfile).toContain('COPY --from=builder /app/contributors.json ./contributors.json');
    expect(dockerfile).toContain('USER appuser');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('http://localhost:3001/health');
    expect(dockerfile).toContain('CMD ["node", "src/server.js"]');
  });
});
