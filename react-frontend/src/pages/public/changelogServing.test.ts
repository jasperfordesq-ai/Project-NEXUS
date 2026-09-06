// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The Changelog page showed members raw HTML for months, and no test could see it.
 *
 * `ChangelogPage` fetches `/changelog.md` and only checks `res.ok`. The blue/green nginx
 * config's `location /` ends in an unconditional `return 421` (serve the SPA shell) and
 * never tries the file on disk, so that request answered **200 with index.html** — which
 * the page accepted as the changelog and rendered. The single-colour `nginx.conf` still
 * has the `try_files $uri` the blue/green config dropped, which is why the page worked
 * before blue/green and silently regressed with it.
 *
 * Every existing test mocks `fetch`, so all of them passed throughout. The defect lived
 * entirely in the gap between the app and the server that serves it — this asserts the
 * serving rule exists, next to the page that depends on it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function config(name: string): string {
  return readFileSync(path.join(frontendRoot, name), 'utf8');
}

describe('the server actually serves the file the Changelog page asks for', () => {
  it('blue/green nginx has an exact-match rule for /changelog.md', () => {
    const conf = config('nginx.bluegreen.conf');

    // Exact match: a prefix or regex rule could widen what else gets served.
    expect(conf).toMatch(/location\s*=\s*\/changelog\.md\s*\{/);

    const block = conf.slice(conf.indexOf('location = /changelog.md'));
    const body = block.slice(0, block.indexOf('}'));

    // It must read from disk and 404 when absent — never fall through to the SPA shell,
    // which is the exact failure this guards.
    expect(body).toMatch(/try_files\s+\$uri\s+=404;/);
    expect(body).toMatch(/default_type\s+text\/markdown;/);
  });

  it('the page and the server rule name the same path', () => {
    const page = readFileSync(path.join(frontendRoot, 'src/pages/public/ChangelogPage.tsx'), 'utf8');
    const fetched = /fetch\(\s*'([^']+)'/.exec(page)?.[1];

    expect(fetched).toBe('/changelog.md');
    expect(config('nginx.bluegreen.conf')).toContain(`location = ${fetched}`);
  });

  it('the single-colour config still resolves it too, so the two cannot drift apart', () => {
    const conf = config('nginx.conf');
    const hasExactRule = /location\s*=\s*\/changelog\.md\s*\{/.test(conf);
    const catchAllTriesDisk = /location \/ \{[\s\S]*?try_files\s+\$uri\b/.test(conf);

    expect(hasExactRule || catchAllTriesDisk).toBe(true);
  });
});
