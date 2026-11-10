// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: headings have a real typeface, served from this site.
 *
 * Until Nov 2026 the site named "Inter" and never loaded it: every heading was
 * the device's default font in bold (warmth plan P4). Headings now use Nunito.
 * Three things must stay true: the font files ship with the site (no request
 * to a font service — privacy, and the Content-Security-Policy allows fonts
 * from 'self'); headings fall back to the device's font for scripts Nunito
 * does not cover; and the broker panel keeps its own look.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.resolve(root, file), 'utf8');

describe('the heading typeface', () => {
  it('is installed as a pinned dependency and imported once, from the site\'s own files', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@fontsource-variable/nunito']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read('src/main.tsx')).toContain("import '@fontsource-variable/nunito/wght.css';");
  });

  it('never loads a font from another server', () => {
    expect(read('index.html')).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(read('src/index.css')).not.toMatch(/@import\s+url\(["']?https?:/);
  });

  it('applies to headings, with the device font as the fallback, and not to the broker panel', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toMatch(/--font-display:\s*"Nunito Variable",\s*ui-sans-serif,\s*system-ui/);
    expect(tokens).toMatch(/:root:not\(\[data-panel="broker"\]\) :is\(h1, h2, h3, h4\) \{\s*font-family: var\(--font-display\);/);
  });
});
