// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/stories.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/stories.json', import.meta.url)));

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

test('complete Irish Stories catalogue retains only reviewed typography and time invariants', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'creator.font_sans',
    'creator.font_serif',
    'creator.video_duration_seconds',
    'creator.video_duration_seconds_one',
    'creator.video_duration_seconds_other',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Stories key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Stories preserves creation, camera, reaction, and highlight meaning', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /sa rogha seo|na rogha|Rogha cruthaithe|Iompaigh ceamara|\nMona\n|Scéal vótála/u);
  assert.equal(irish.creator.discard, 'Caith uait');
  assert.equal(irish.creator.flip_camera, 'Athraigh ceamara');
  assert.equal(irish.creator.capture, 'Glac grianghraf');
  assert.equal(irish.viewer.react_with, 'Imoibrigh le {{type}}');
  assert.match(irish.highlights.create_title, /buaicphointe/u);
  assert.match(irish.highlights.create_hint, /mbuaicphointe/u);
  assert.equal(irish.highlights.story_type_poll, 'Scéal pobalbhreithe');
});
