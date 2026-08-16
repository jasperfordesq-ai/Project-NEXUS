// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/podcasts.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/podcasts.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      flatten(item, path, result);
    } else if (typeof item === 'string') {
      result.set(path, item);
    }
  }
  return result;
}

test('Irish podcast listener experience has no unexplained English fallback', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set(['browse.sort.title', 'player.speed']);
  const reviewedPaths = [...englishFlat.keys()].filter((path) =>
    !path.startsWith('studio.') &&
    !path.startsWith('fields.') &&
    !path.startsWith('visibility.') &&
    !path.startsWith('status.') &&
    !path.startsWith('moderation.'),
  );

  for (const path of reviewedPaths) {
    assert.ok(irishFlat.has(path), `Missing Irish podcast key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishFlat.get(path), path);
    } else {
      assert.notEqual(irishFlat.get(path), englishFlat.get(path), path);
    }
  }

  assert.doesNotMatch(irish.show.unsubscribe, /[\u200B-\u200D\uFEFF]/u);
  assert.doesNotMatch(irish.episode.download_transcript, /béarla/i);
  assert.doesNotMatch(irish.player.load_error, /heachtra/i);
});
