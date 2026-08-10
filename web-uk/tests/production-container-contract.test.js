// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

describe('production container source contract', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

  it('supports a digest-pinned shared Node base image on a supported Node major', () => {
    // 🔴 This asserted the exact string `ARG NODE_IMAGE=node:20-alpine`, and it
    // passed happily for the three months after Node 20 went END OF LIFE on
    // 2026-04-30. An exact pin proves the version is what someone once wrote
    // down; it says nothing about whether that version still gets security
    // patches, which is the thing actually worth failing over.
    //
    // A FLOOR catches the real risk in both directions: drifting back onto an
    // unsupported major fails, while a future deliberate upgrade (24, 26...)
    // does not need this test edited. Raise MINIMUM_NODE_MAJOR when the current
    // floor reaches end of life.
    //
    // Node 22 ("Jod") is the active LTS, supported to 2027-04.
    const MINIMUM_NODE_MAJOR = 22;

    const baseImage = dockerfile.match(/^ARG NODE_IMAGE=node:(\d+)-alpine$/m);
    expect(baseImage).not.toBeNull();
    expect(Number(baseImage[1])).toBeGreaterThanOrEqual(MINIMUM_NODE_MAJOR);

    expect(dockerfile.match(/^FROM \$\{NODE_IMAGE\}/gm)).toHaveLength(2);
    expect(dockerfile).not.toMatch(/^FROM node:/m);
  });

  it('declares an engines floor that matches the image it actually ships', () => {
    // package.json said ">=18.19.0" while the image shipped 20 and CI tested on
    // 22 — three different answers to "what Node does this run on". Anyone
    // trusting the engines field would have installed an EOL runtime.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    );
    const imageMajor = Number(dockerfile.match(/^ARG NODE_IMAGE=node:(\d+)-alpine$/m)[1]);
    const enginesMajor = Number(pkg.engines.node.match(/(\d+)/)[1]);

    expect(enginesMajor).toBe(imageMajor);
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
