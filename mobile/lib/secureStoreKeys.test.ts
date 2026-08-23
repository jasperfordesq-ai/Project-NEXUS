// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every key written through `lib/storage.ts` must be one `expo-secure-store` will accept.
 *
 * 🔴 SecureStore refuses a key containing anything outside `[A-Za-z0-9._-]`, and it does so
 * by throwing. `storage.set` swallows write errors on purpose (it reports them and carries
 * on, so a storage fault cannot log a member out), so an illegal key fails completely
 * silently: the write throws, the read returns null, and only a caller that verifies its
 * own write ever notices.
 *
 * One did. `nexus:event-checkin:encryption-key:v1` — three colons — meant the offline
 * check-in queue could never be activated on any Android device. Measured on 2026-08-23:
 * authorising a staff device succeeded server-side three requests deep and the organiser
 * was told the action could not be completed. Every other key in the app uses underscores,
 * which is why nothing else broke.
 *
 * A scan rather than a runtime check: the failure is silent by design, so it has to be
 * caught before it ships.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components', 'lib'];

/** expo-secure-store: alphanumerics, dot, dash, underscore. Nothing else. */
const SECURE_STORE_KEY = /^[A-Za-z0-9._-]+$/;

function collectSources(dir: string, out: string[] = []): string[] {
  const abs = path.join(MOBILE_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectSources(rel, out);
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.test.')) continue;
    out.push(rel);
  }
  return out;
}

/**
 * Any string literal assigned to a constant whose name ends in STORAGE_KEY / _KEY, or held
 * in a STORAGE_KEYS map. Deliberately narrow: it looks for the declaration sites where a
 * storage key is named, not for every string in the app.
 */
function declaredStorageKeys(source: string): string[] {
  const keys: string[] = [];
  const singleConst = /const\s+[A-Z0-9_]*(?:STORAGE_KEY|_KEY)\s*(?::\s*[^=]+)?=\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = singleConst.exec(source)) !== null) keys.push(match[1]);

  const mapBlock = /STORAGE_KEYS\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(source);
  if (mapBlock) {
    const entries = /:\s*'([^']+)'/g;
    while ((match = entries.exec(mapBlock[1])) !== null) keys.push(match[1]);
  }
  return keys;
}

describe('secure-store keys', () => {
  const files = SEARCH_DIRS.flatMap((dir) => collectSources(dir));

  it('finds keys to check', () => {
    const all = files.flatMap((file) =>
      declaredStorageKeys(fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8')),
    );
    expect(all.length).toBeGreaterThan(5);
  });

  it('never declares a key expo-secure-store would refuse', () => {
    const illegal: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      for (const key of declaredStorageKeys(source)) {
        if (!SECURE_STORE_KEY.test(key)) {
          illegal.push(`${file.split(path.sep).join('/')}: ${key}`);
        }
      }
    }

    expect(illegal).toEqual([]);
  });
});
