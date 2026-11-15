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
 *
 * Since 15 Nov 2026 the page reads `/changelog-data/index.json` and one file per release
 * from the same folder, not `/changelog.md`. The same gap applies to them, so the same
 * check does. `/changelog.md` is still copied and still served, so its rule stays pinned.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CHANGELOG_DATA_PATH } from './changelog/useChangelog';

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

  it('blue/green nginx reads the per-release data files from disk, and 404s a missing one', () => {
    const conf = config('nginx.bluegreen.conf');

    // The page builds every address from this constant, so the rule is checked
    // against the path the page really asks for.
    expect(CHANGELOG_DATA_PATH).toBe('/changelog-data/');
    const rule = `location ^~ ${CHANGELOG_DATA_PATH} {`;
    expect(conf).toContain(rule);

    const block = conf.slice(conf.indexOf(rule));
    const body = block.slice(0, block.indexOf('}'));

    // Never fall through to the SPA shell: a missing release must be a 404,
    // which the page shows as "could not load", not as app markup.
    expect(body).toMatch(/try_files\s+\$uri\s+=404;/);
    expect(body).toMatch(/default_type\s+application\/json;/);
  });

  it('the build writes the data files where the page looks for them', () => {
    const script = readFileSync(path.join(frontendRoot, 'scripts/copy-changelog.mjs'), 'utf8');
    const folder = CHANGELOG_DATA_PATH.replace(/\//g, '');

    expect(script).toContain(`'public', '${folder}'`);
    // Generated at build time, so it must not be committed.
    expect(readFileSync(path.join(frontendRoot, '.gitignore'), 'utf8')).toContain(`public/${folder}/`);
  });

  it('the single-colour config still resolves it too, so the two cannot drift apart', () => {
    const conf = config('nginx.conf');
    const hasExactRule = /location\s*=\s*\/changelog\.md\s*\{/.test(conf);
    const catchAllTriesDisk = /location \/ \{[\s\S]*?try_files\s+\$uri\b/.test(conf);

    expect(hasExactRule || catchAllTriesDisk).toBe(true);
  });
});
