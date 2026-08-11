#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-doc-scores — make the `<!-- doc-consistency: KEY=VALUE -->` markers mean
 * something.
 *
 * 🔴 Why this exists. Those markers looked like a CI-enforced contract and were
 * not: nothing in this repository read them. Any score could drift, be quietly
 * lowered, or contradict its own table with no failure anywhere. Two separate
 * 1000-point rubrics also shared one marker shape, so two unrelated numbers
 * could be read as one.
 *
 * 🔴 THE ARTEFACT IS THE TRUTH AND THE MARKER FOLLOWS IT. The archived version
 * of this idea had it backwards — it pinned counts and then asked documents to be
 * rewritten to match a historical pin, which is how a document ends up
 * complaining that it is being asked to contradict its own evidence. Here, a
 * mismatch means REGENERATE THE ARTEFACT AND CORRECT THE DOCUMENT.
 *
 * What is asserted:
 *   1. No unknown marker keys. A new score needs a deliberate entry here.
 *   2. Every `*_SCORE`/`*_INDEX` marker's `N/M` equals its document's own table
 *      total, and that table's Earned and Maximum columns each sum correctly.
 *   3. Every score marker has exactly one rubric-id companion, and no two
 *      documents claim the same rubric id.
 *   4. Counts quoted in the scoring document match the generated JSON artefacts.
 *   5. Both generated artefacts name the same commit SHA; if either records a
 *      dirty working tree, the scoring document must disclose it.
 *   6. Pause markers use a valid enum and carry a companion date.
 *
 * Modelled on scripts/check-version-consistency.mjs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);

const read = (relativePath) => {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) {
    fail(`${relativePath}: file not found. A marker cannot be verified against a document that does not exist.`);
    return null;
  }
  return readFileSync(absolute, 'utf8');
};

/**
 * Every marker key that may appear anywhere in the repository.
 *
 * `kind`:
 *   score   — an `N/M` value that must equal its document's own table total
 *   rubric  — a rubric identifier; must be unique across documents
 *   pause   — a pause state; must be in `enum` and carry `companionDate`
 *   opaque  — a recorded value with no cross-check (SHAs, counts, baselines)
 */
const KNOWN_MARKERS = {
  // Web UK — W1, retired 2026-08-11.
  WEBUK_W1_RETIRED_SCORE: {
    kind: 'score',
    doc: 'web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
    rubricMarker: 'WEBUK_W1_RUBRIC',
    tableHeading: '### Current Banked Score'
  },
  WEBUK_W1_RETIRED_ON: { kind: 'opaque' },
  WEBUK_W1_RUBRIC: { kind: 'rubric' },

  // Web UK — W2, current.
  WEBUK_W2_CURRENT_SCORE: {
    kind: 'score',
    doc: 'web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md',
    rubricMarker: 'WEBUK_W2_RUBRIC',
    tableHeading: '## Rubric ',
    artefactCounts: true
  },
  WEBUK_W2_RUBRIC: { kind: 'rubric' },
  WEBUK_W2_ARTEFACT_TREE: { kind: 'opaque' },

  // ASP.NET — separate rubric, paused. Deliberately NOT cross-checked against a
  // table: it is a backend-owned document this workstream must not rescore.
  ASPNET_CURRENT_BANKED_SCORE: { kind: 'opaque', requiresRubric: 'ASPNET_CURRENT_RUBRIC' },
  ASPNET_CURRENT_RUBRIC: { kind: 'rubric' },

  // Documentation health — an INDEX, not a product score. Renamed 2026-08-11.
  DOCUMENTATION_HEALTH_INDEX: { kind: 'opaque', requiresRubric: 'DOCUMENTATION_HEALTH_RUBRIC' },
  DOCUMENTATION_HEALTH_RUBRIC: { kind: 'rubric' },
  DOCUMENTATION_HEALTH_BASELINE: { kind: 'opaque' },
  DOCUMENTATION_HEALTH_REVALIDATION: { kind: 'opaque' },

  // Pause state.
  // 🔴 Split on 2026-08-11. One marker paused two workstreams; web-uk was lifted
  // and ASP.NET was not. Leaving it PAUSED was false; flipping it would have
  // falsely un-paused a backend whose database has no recent backup.
  PROJECT_PAUSE_STATE_ASPNET: {
    kind: 'pause',
    enum: ['PAUSED', 'LIFTED'],
    companionDate: 'PROJECT_PAUSE_DATE'
  },
  PROJECT_PAUSE_STATE_WEBUK: {
    kind: 'pause',
    enum: ['PAUSED', 'LIFTED'],
    companionDate: 'PROJECT_PAUSE_LIFTED_WEBUK_ON'
  },
  PROJECT_PAUSE_LIFTED_WEBUK_ON: { kind: 'opaque' },
  PROJECT_PAUSE_DATE: { kind: 'opaque' },
  PROJECT_PAUSE_FINAL_TAG: { kind: 'opaque' },
  PROJECT_PAUSE_CURRENT_TAG: { kind: 'opaque' },

  // Schema readiness.
  SCHEMA_CURRENT_PRODUCT_SHA: { kind: 'opaque' },
  SCHEMA_CURRENT_RUNTIME_MIGRATIONS: { kind: 'opaque' }
};

/**
 * 🔴 Renamed keys. A stale reader must fail loudly rather than silently reporting
 * a retired number as current, so the OLD name is banned outright.
 */
const RETIRED_MARKERS = {
  WEBUK_CURRENT_BANKED_SCORE: 'renamed to WEBUK_W1_RETIRED_SCORE when W1 was retired on 2026-08-11; the current score is WEBUK_W2_CURRENT_SCORE',
  DOCUMENTATION_HEALTH_SCORE: 'renamed to DOCUMENTATION_HEALTH_INDEX on 2026-08-11 so it cannot be mistaken for a product score',
  PROJECT_PAUSE_STATE: 'split on 2026-08-11 into PROJECT_PAUSE_STATE_ASPNET and PROJECT_PAUSE_STATE_WEBUK; one marker cannot describe two workstreams whose states now differ'
};

// Documents that may carry markers. Kept explicit: a marker appearing in an
// unlisted file is itself a finding, because it means a score now lives
// somewhere nobody is looking.
const MARKER_DOCUMENTS = [
  'web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
  'web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md',
  'aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
  'aspnet-backend/docs/DOCUMENTATION_HEALTH_REPORT.md',
  'aspnet-backend/docs/CURRENT_SCHEMA_READINESS.md',
  'aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md'
];

const MARKER_PATTERN = /<!--\s*doc-consistency:\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*-->/g;

/** @type {Map<string, {value: string, doc: string}[]>} */
const found = new Map();

for (const relativePath of MARKER_DOCUMENTS) {
  const content = read(relativePath);
  if (content === null) continue;

  for (const match of content.matchAll(MARKER_PATTERN)) {
    const [, key, value] = match;

    if (RETIRED_MARKERS[key]) {
      fail(`${relativePath}: marker ${key} is retired — ${RETIRED_MARKERS[key]}.`);
      continue;
    }
    if (!KNOWN_MARKERS[key]) {
      fail(`${relativePath}: unknown marker ${key}. Add it to KNOWN_MARKERS in scripts/check-doc-scores.mjs with its kind, or remove it. An unregistered score is a score nothing checks.`);
      continue;
    }

    if (!found.has(key)) found.set(key, []);
    found.get(key).push({ value, doc: relativePath });
  }
}

// ---------------------------------------------------------------------------
// Rubric ids must be unique across documents.
// ---------------------------------------------------------------------------
const rubricOwners = new Map();
for (const [key, occurrences] of found) {
  if (KNOWN_MARKERS[key].kind !== 'rubric') continue;
  for (const { value, doc } of occurrences) {
    if (rubricOwners.has(value)) {
      fail(`Rubric id ${value} is claimed by both ${rubricOwners.get(value)} and ${doc}. Two documents sharing one rubric id is how two unrelated 1000-point scores get read as one.`);
      continue;
    }
    rubricOwners.set(value, doc);
  }
}

// ---------------------------------------------------------------------------
// Every score marker needs exactly one rubric companion in the same document.
// ---------------------------------------------------------------------------
for (const [key, occurrences] of found) {
  const spec = KNOWN_MARKERS[key];
  const rubricKey = spec.rubricMarker || spec.requiresRubric;
  if (!rubricKey) continue;

  for (const { doc } of occurrences) {
    const companions = (found.get(rubricKey) || []).filter((entry) => entry.doc === doc);
    if (companions.length !== 1) {
      fail(`${doc}: ${key} needs exactly one ${rubricKey} companion in the same document, found ${companions.length}. Without a rubric id, a score cannot be told apart from an unrelated score with the same denominator.`);
    }
  }
}

// ---------------------------------------------------------------------------
// A score marker must equal its document's own table total, and the table's
// columns must sum.
// ---------------------------------------------------------------------------
const parseScore = (raw) => {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  return match ? { earned: Number(match[1]), maximum: Number(match[2]) } : null;
};

/**
 * Pull `N/M` pairs out of a markdown table.
 *
 * Handles both shapes in use: a single `Earned` cell holding `99/100` (W1) and
 * separate `Earned` / `Maximum` columns (W2). The row whose first cell is bold is
 * the declared total and is excluded from the sum.
 */
const readRubricTable = (content, heading) => {
  const start = content.indexOf(heading);
  if (start === -1) return { error: `heading ${JSON.stringify(heading)} not found` };

  const afterHeading = content.slice(start);
  const lines = afterHeading.split(/\r?\n/);
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const isRow = line.trimStart().startsWith('|');
    if (!isRow) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }

  if (rows.length < 3) return { error: 'fewer than three table rows found below the heading' };

  const header = rows.shift();
  const earnedIndex = header.findIndex((cell) => /earned/i.test(cell));
  const maximumIndex = header.findIndex((cell) => /maximum/i.test(cell));
  if (earnedIndex === -1) return { error: 'no Earned column in the rubric table' };

  const cellNumber = (cell) => {
    const cleaned = cell.replace(/\*/g, '').trim();
    const pair = /^(\d+)\s*\/\s*(\d+)/.exec(cleaned);
    if (pair) return { earned: Number(pair[1]), maximum: Number(pair[2]) };
    const single = /^(\d+)$/.exec(cleaned);
    return single ? { earned: Number(single[1]), maximum: null } : null;
  };

  let totalRow = null;
  let sumEarned = 0;
  let sumMaximum = 0;
  let rowsCounted = 0;

  for (const cells of rows) {
    const isTotal = /^\s*\*\*/.test(cells[0]);
    const earnedCell = cellNumber(cells[earnedIndex] ?? '');
    if (!earnedCell) continue;

    const maximum = maximumIndex === -1
      ? earnedCell.maximum
      : (cellNumber(cells[maximumIndex] ?? '')?.earned ?? null);

    if (isTotal) {
      totalRow = { earned: earnedCell.earned, maximum };
      continue;
    }
    if (maximum === null) continue;

    sumEarned += earnedCell.earned;
    sumMaximum += maximum;
    rowsCounted += 1;
  }

  if (!totalRow) return { error: 'no bold total row found in the rubric table' };
  if (rowsCounted === 0) return { error: 'no scoring rows found in the rubric table' };

  return { totalRow, sumEarned, sumMaximum, rowsCounted };
};

for (const [key, occurrences] of found) {
  const spec = KNOWN_MARKERS[key];
  if (spec.kind !== 'score') continue;

  for (const { value, doc } of occurrences) {
    const declared = parseScore(value);
    if (!declared) {
      fail(`${doc}: ${key}=${value} is not in N/M form.`);
      continue;
    }

    const content = read(spec.doc);
    if (content === null) continue;

    const table = readRubricTable(content, spec.tableHeading);
    if (table.error) {
      fail(`${spec.doc}: cannot read the rubric table for ${key} — ${table.error}.`);
      continue;
    }

    if (table.sumEarned !== table.totalRow.earned) {
      fail(`${spec.doc}: rubric rows for ${key} sum to ${table.sumEarned} earned but the total row says ${table.totalRow.earned}. Fix the arithmetic, do not adjust the total.`);
    }
    if (table.totalRow.maximum !== null && table.sumMaximum !== table.totalRow.maximum) {
      fail(`${spec.doc}: rubric rows for ${key} sum to ${table.sumMaximum} maximum but the total row says ${table.totalRow.maximum}.`);
    }
    if (declared.earned !== table.totalRow.earned || declared.maximum !== table.totalRow.maximum) {
      fail(`${spec.doc}: marker ${key}=${value} disagrees with its own table total ${table.totalRow.earned}/${table.totalRow.maximum}. The document's table is the record; correct whichever is wrong, but never leave them disagreeing.`);
    }
    notes.push(`${key} = ${table.totalRow.earned}/${table.totalRow.maximum} across ${table.rowsCounted} rubric rows (${spec.doc})`);
  }
}

// ---------------------------------------------------------------------------
// Quoted counts must match the generated artefacts, and both artefacts must
// name one commit.
// ---------------------------------------------------------------------------
const scoringDocs = [...found.entries()]
  .filter(([key]) => KNOWN_MARKERS[key].kind === 'score' && KNOWN_MARKERS[key].artefactCounts)
  .map(([key]) => KNOWN_MARKERS[key].doc);

if (scoringDocs.length > 0) {
  const artefacts = {
    matrix: 'web-uk/docs/generated/accessible-route-matrix.json',
    ledger: 'web-uk/docs/generated/frontend-api-consumer-ledger.json'
  };

  /** @type {Record<string, any>} */
  const loaded = {};
  for (const [name, relativePath] of Object.entries(artefacts)) {
    const raw = read(relativePath);
    if (raw === null) continue;
    try {
      loaded[name] = JSON.parse(raw);
    } catch (error) {
      fail(`${relativePath}: not valid JSON (${error.message}). Regenerate it.`);
    }
  }

  if (loaded.matrix && loaded.ledger) {
    const matrixSha = loaded.matrix.provenance?.laravelCommitSha;
    const ledgerSha = loaded.ledger.provenance?.laravelCommitSha;
    if (!matrixSha || !ledgerSha) {
      fail('Generated artefacts are missing a provenance commit SHA. Regenerate both.');
    } else if (matrixSha !== ledgerSha) {
      fail(`Generated artefacts name different commits (route matrix ${matrixSha.slice(0, 12)}, API ledger ${ledgerSha.slice(0, 12)}). Regenerate them back to back from one checkout, or the two sets of counts describe different code.`);
    }

    const dirty = Boolean(loaded.matrix.provenance?.laravelWorkingTreeDirty)
      || Boolean(loaded.matrix.provenance?.webUkRepositoryWorkingTreeDirty)
      || Boolean(loaded.ledger.provenance?.laravelWorkingTreeDirty)
      || Boolean(loaded.ledger.provenance?.webUkRepositoryWorkingTreeDirty);

    for (const doc of new Set(scoringDocs)) {
      const content = read(doc);
      if (content === null) continue;

      // 🔴 A dirty artefact is not blocked, because a concurrent session's
      // unrelated work must not turn main red. It must be DISCLOSED, so a reader
      // knows the counts were taken over uncommitted changes.
      if (dirty && !/workingTreeDirty|working-tree disclosure|dirty working tree/i.test(content)) {
        fail(`${doc}: a generated artefact records a dirty working tree and this document does not disclose it. Add the disclosure rather than silently quoting the counts.`);
      }

      // The counts the document quotes must be the artefact's own.
      const expected = [
        ['Laravel routes', String(loaded.matrix.summary?.laravelRoutes ?? '')],
        ['matched routes', String(loaded.matrix.summary?.matchedRoutes ?? '')],
        ['web-uk routes', String(loaded.matrix.summary?.webUkRoutes ?? '')],
        ['API contracts', String(loaded.ledger.summary?.contracts ?? '')],
        ['state-changing contracts', String(loaded.ledger.summary?.stateChanging ?? '')]
      ];
      for (const [label, expectedValue] of expected) {
        if (!expectedValue) {
          fail(`${doc}: cannot read ${label} from the generated artefact to compare against the document.`);
          continue;
        }
        if (!content.includes(expectedValue)) {
          fail(`${doc}: the generated artefact reports ${label} = ${expectedValue}, which does not appear anywhere in this document. Regenerate the artefact, then correct the document — the artefact is the truth.`);
        }
      }
      notes.push(`${doc} agrees with both artefacts at commit ${matrixSha?.slice(0, 12)}${dirty ? ' (dirty tree, disclosed)' : ' (clean tree)'}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pause markers.
// ---------------------------------------------------------------------------
for (const [key, occurrences] of found) {
  const spec = KNOWN_MARKERS[key];
  if (spec.kind !== 'pause') continue;

  for (const { value, doc } of occurrences) {
    if (!spec.enum.includes(value)) {
      fail(`${doc}: ${key}=${value} is not one of ${spec.enum.join(', ')}.`);
    }
    const companion = (found.get(spec.companionDate) || []).filter((entry) => entry.doc === doc);
    if (companion.length !== 1) {
      fail(`${doc}: ${key} needs exactly one ${spec.companionDate} companion, found ${companion.length}. A pause state with no date cannot be judged stale.`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(companion[0].value)) {
      fail(`${doc}: ${spec.companionDate}=${companion[0].value} is not an ISO date.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('check-doc-scores FAILED\n');
  for (const message of failures) console.error(`  - ${message}`);
  console.error(`\n${failures.length} problem(s). 🔴 The generated artefacts are the truth; correct the document, not the evidence.`);
  process.exit(1);
}

console.log(`check-doc-scores OK — ${found.size} marker key(s) across ${MARKER_DOCUMENTS.length} document(s).`);
for (const note of notes) console.log(`  - ${note}`);
