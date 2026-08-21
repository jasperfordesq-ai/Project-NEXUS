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
 *      total, and that table's Earned/Banked and Maximum columns each sum
 *      correctly.
 *   3. Every score marker has exactly one rubric-id companion, and no two
 *      documents claim the same rubric id.
 *   4. Counts quoted in the scoring document match the generated JSON artefacts.
 *   5. Both generated artefacts name the same commit SHA; if either records a
 *      dirty working tree, the scoring document must disclose it.
 *   6. Pause markers use a valid enum and carry a companion date.
 *   7. A `ledger` marker's row total equals the sum of its document's own
 *      per-tier totals, every tier's summary counts equal the statuses actually
 *      counted in that tier's row table, and no row carries a status the
 *      document's own vocabulary table does not define.
 *   8. Every journey category in the ASP.NET status doc equals
 *      `round(weight × credit recomputed from the ledger rows)`, ±1 for
 *      documented rounding. A category the checker cannot map to tiers FAILS.
 *   9. The published ASP.NET score is at or above its recorded floor.
 *  10. The migration count quoted by the schema document equals the migrations
 *      actually on disk.
 *  11. Retired score literals and retired rubric ids do not appear in
 *      maintained Markdown.
 *
 * 🔴 Items 7–11 were added on 2026-08-21 after an audit found that BOTH ASP.NET
 * markers were `opaque` — so the published headline was never compared with the
 * table directly beneath it, and the 130-row journey denominator was never
 * compared with the ledger's own tier tables. A comment in this very file
 * claimed the row marker "only pins the row TOTAL so it cannot drift silently";
 * nothing pinned anything. That is the exact failure mode the header above rails
 * against, reproduced inside the checker for the second time.
 *
 * Modelled on scripts/check-version-consistency.mjs.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

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
 *   ledger  — a row total that must equal the sum of its document's own per-tier
 *             tables, which are themselves recounted row by row
 *   opaque  — a recorded value with no cross-check (SHAs, tags, baselines)
 *
 * 🔴 `opaque` is a last resort, not a default. Every marker below that is opaque
 * and *could* be derived from something has an explicit check further down
 * instead (see ASPNET_BANKED_FLOOR and SCHEMA_CURRENT_RUNTIME_MIGRATIONS). An
 * opaque marker with a checkable source is decoration.
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

  // ASP.NET — separate rubric, cross-checked against its own Block 2 table.
  //
  // 🔴 This entry was `opaque` until 2026-08-21, justified as "a backend-owned
  // document this workstream must not rescore". That inverted the point of the
  // file. Reading a document's own table is not rescoring it — it is the only way
  // to catch a headline that no longer matches the table printed directly beneath
  // it. While it was opaque the ASP.NET score could be edited to any value, in
  // either direction, with nothing anywhere disagreeing.
  //
  // 🔴 An earlier comment here also said "paused". The ASP.NET pause was lifted on
  // 2026-08-14 (see PROJECT_PAUSE_STATE_ASPNET below, which was already correct) —
  // a stale word in a checker's comment is how an agent concludes a live
  // workstream is frozen.
  ASPNET_CURRENT_BANKED_SCORE: {
    kind: 'score',
    doc: 'aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
    rubricMarker: 'ASPNET_CURRENT_RUBRIC',
    // The Banked/Maximum table lives under this heading, below Block 1's prose.
    tableHeading: '## Banked score',
    // The row count the document's prose claims in words ("nine fixed-weight
    // categories"). An audit found docs saying "eight" while the table had nine.
    categoryCountMarker: 'ASPNET_RUBRIC_CATEGORY_COUNT',
    // The ratchet: the published numerator may never fall below this.
    floorMarker: 'ASPNET_BANKED_FLOOR',
    // Journey categories in this table are derived from the ledger's rows.
    ledgerMarker: 'ASPNET_JOURNEY_ROWS'
  },
  ASPNET_CURRENT_RUBRIC: { kind: 'rubric' },
  ASPNET_RUBRIC_CATEGORY_COUNT: { kind: 'opaque' },
  ASPNET_BANKED_FLOOR: { kind: 'opaque' },
  // The finite journey denominator introduced 2026-08-21 with rubric R4.
  //
  // 🔴 This said: "Opaque by design: the ledger's own tier table is the authority
  // for the breakdown, and this marker only pins the row TOTAL so it cannot drift
  // silently." Every clause of that was false. `opaque` means no cross-check at
  // all, so the marker pinned nothing, the tier table was compared with nothing,
  // and a row could carry an invented status (`PARTIAL→OPEN` did) whose credit
  // weight does not exist — while four category scores were being computed from
  // those weights. It is now a `ledger` marker: the tier tables are recounted row
  // by row, the summary must agree with the recount, and the statuses must be the
  // ledger's own.
  ASPNET_JOURNEY_ROWS: {
    kind: 'ledger',
    doc: 'aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md'
  },

  // The mobile workstream's own journey denominator, registered 2026-08-21.
  //
  // 🔴 Registered as a FULL `ledger` marker, not `opaque`. The unregistered-
  // marker guard caught this document the moment it appeared, which is the guard
  // doing its job — but registering it as an unchecked value would have swapped a
  // loud failure for a silent one, which is the exact defect this file was
  // hardened to remove. Its tier tables use the same structure and the same
  // status vocabulary as the ASP.NET ledger, so the strict recount applies
  // unchanged: summary counts must equal the counted rows, tiers must sum to the
  // marker, and no status outside its own vocabulary is allowed.
  //
  // 🔴 SCOPE OVERLAP TO RESOLVE, flagged not silently reconciled: the
  // ASP.NET ledger also carries a mobile tier (34 rows, Tier 6) because the owner
  // put the mobile app in ASP.NET scope on 2026-08-21. Two documents therefore
  // enumerate mobile journeys against different denominators and for different
  // questions — this one asks "does the mobile app work", the ASP.NET tier asks
  // "does the mobile app work against the ASP.NET backend". Both are legitimate
  // and they are NOT the same question, but they must never be added, averaged,
  // or read as one number. An owner decision on how they relate is outstanding.
  MOBILE_JOURNEY_ROWS: {
    kind: 'ledger',
    doc: 'mobile/docs/MOBILE_JOURNEY_LEDGER.md'
  },

  // Mobile app — rubric M1, introduced 2026-08-21.
  //
  // 🔴 Registered on the day the mobile documentation was restructured, and registered
  // WITH a floor and a ledger rather than as `opaque`. The mobile app had carried a
  // 17-row scorecard in a document that grew by appending dated sections until its top
  // described a different app from its bottom — and nothing anywhere could disagree with
  // a number in it. An unenforced score is how the ASP.NET workstream lost time; the
  // mobile score is enforced from its first day for that reason.
  //
  // M1 measures how much of the PRODUCT is proved to work. Earlier mobile scorecards
  // measured code quality. Those are different questions: never subtract them, and never
  // describe M1 as a rise or fall from one of them.
  MOBILE_M1_CURRENT_SCORE: {
    kind: 'score',
    doc: 'mobile/docs/CURRENT_MOBILE_PRODUCTION_STATUS.md',
    rubricMarker: 'MOBILE_M1_RUBRIC',
    tableHeading: '## Banked score',
    categoryCountMarker: 'MOBILE_RUBRIC_CATEGORY_COUNT',
    floorMarker: 'MOBILE_BANKED_FLOOR'
  },
  MOBILE_M1_RUBRIC: { kind: 'rubric' },
  MOBILE_RUBRIC_CATEGORY_COUNT: { kind: 'opaque' },
  MOBILE_BANKED_FLOOR: { kind: 'opaque' },
  // The finite mobile journey denominator. `ledger` and not `opaque`, so the tier tables
  // are recounted row by row and a status outside the vocabulary is rejected — the exact
  // check whose absence let an ASP.NET row carry an invented status while four category
  // scores were computed from it.
  MOBILE_JOURNEY_ROWS: {
    kind: 'ledger',
    doc: 'mobile/docs/MOBILE_JOURNEY_LEDGER.md'
  },

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
    // 🔴 Was companioned to PROJECT_PAUSE_DATE (the date the pause STARTED), which
    // could not express "lifted, and when". The owner lifted the ASP.NET pause on
    // 2026-08-14; the marker still read PAUSED until 2026-08-18. Now companioned to
    // its own lift date, exactly as the web-uk marker is.
    companionDate: 'PROJECT_PAUSE_LIFTED_ASPNET_ON'
  },
  PROJECT_PAUSE_STATE_WEBUK: {
    kind: 'pause',
    enum: ['PAUSED', 'LIFTED'],
    companionDate: 'PROJECT_PAUSE_LIFTED_WEBUK_ON'
  },
  PROJECT_PAUSE_LIFTED_WEBUK_ON: { kind: 'opaque' },
  PROJECT_PAUSE_LIFTED_ASPNET_ON: { kind: 'opaque' },
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

// Documents that may carry markers. Kept explicit, and enforced by a repo-wide
// scan further down — see `assertNoUnregisteredMarkerDocuments()`.
//
// 🔴 This comment used to claim that "a marker appearing in an unlisted file is
// itself a finding". It was not: the script only ever read this list and never
// looked anywhere else, so a score added to a new document would have been
// completely invisible — the exact orphaned-marker problem this checker exists to
// solve, reproduced inside the checker. The scan below makes the claim true.
const MARKER_DOCUMENTS = [
  'mobile/docs/CURRENT_MOBILE_PRODUCTION_STATUS.md',
  'mobile/docs/MOBILE_JOURNEY_LEDGER.md',
  'web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md',
  'web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md',
  'aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md',
  'aspnet-backend/docs/DOCUMENTATION_HEALTH_REPORT.md',
  'aspnet-backend/docs/CURRENT_SCHEMA_READINESS.md',
  'aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md',
  'mobile/docs/MOBILE_JOURNEY_LEDGER.md',
  'aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md'
];

const MARKER_PATTERN = /<!--\s*doc-consistency:\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*-->/g;

/**
 * Walk the repository for Markdown files carrying markers, and fail on any that
 * MARKER_DOCUMENTS does not list.
 *
 * 🔴 Without this, adding a score to a new document put it beyond every check in
 * this file — silently. Scanning `.md` only is deliberate and sufficient: a marker
 * is an HTML comment in prose, and it also excludes this script, whose own regex
 * literal would otherwise match itself.
 */
function assertNoUnregisteredMarkerDocuments() {
  const SKIP_DIRS = new Set([
    'node_modules', 'vendor', '.git', 'site', 'dist', 'build', 'coverage',
    // Local scratch and archived output — not maintained documentation.
    '.local-docs-archive', '.heroui-docs', 'storage', 'releases'
  ]);
  const registered = new Set(MARKER_DOCUMENTS.map((p) => p.split('/').join(sep)));
  const seen = [];

  const walk = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not this checker's business
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(absolute, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;

      const full = join(absolute, entry.name);
      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!/<!--\s*doc-consistency:/.test(text)) continue;

      const rel = relative(ROOT, full);
      seen.push(rel);
      if (!registered.has(rel)) {
        failures.push(
          `${rel.split(sep).join('/')}: carries a doc-consistency marker but is NOT in `
          + 'MARKER_DOCUMENTS, so none of the checks in scripts/check-doc-scores.mjs '
          + 'apply to it. Add it to that list (and give any score a rubric id), or '
          + 'remove the marker. An unregistered score is a score nothing checks.'
        );
      }
    }
  };

  walk(ROOT);
  notes.push(`repo scan: ${seen.length} Markdown file(s) carry markers, all registered`);
}

assertNoUnregisteredMarkerDocuments();

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
 *
 * 🔴 The earned column is matched on `earned|banked`. It was `earned` alone, which
 * is why the ASP.NET table — whose columns are **Banked** / **Maximum** — could
 * not be read at all, and is a large part of why that score was left `opaque`. A
 * checker that cannot parse a table is not evidence that the table is unusual.
 * Both Web UK tables head that column `Earned`, so neither is affected.
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
  const earnedIndex = header.findIndex((cell) => /earned|banked/i.test(cell));
  const maximumIndex = header.findIndex((cell) => /maximum/i.test(cell));
  if (earnedIndex === -1) return { error: 'no Earned/Banked column in the rubric table' };

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
  /** Non-total scoring rows, kept so per-category assertions can be made on them. */
  const scoringRows = [];

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
    scoringRows.push({
      name: (cells[0] ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim(),
      earned: earnedCell.earned,
      maximum
    });
  }

  if (!totalRow) return { error: 'no bold total row found in the rubric table' };
  if (rowsCounted === 0) return { error: 'no scoring rows found in the rubric table' };

  return { totalRow, sumEarned, sumMaximum, rowsCounted, scoringRows };
};

/**
 * Parsed rubric tables, kept so the per-category assertions below can reuse the
 * parse instead of reading the document a second time.
 * @type {Map<string, {doc: string, declared: {earned: number, maximum: number}, table: any}>}
 */
const rubricTables = new Map();

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
    rubricTables.set(key, { doc: spec.doc, declared, table });

    // How many scoring categories the table actually has.
    //
    // 🔴 Documents describe their own rubric in words ("nine fixed-weight
    // categories") and prose does not renumber itself when a row is added. An
    // audit found exactly that: the count said eight while the table had nine.
    if (spec.categoryCountMarker) {
      const companions = (found.get(spec.categoryCountMarker) || []).filter((entry) => entry.doc === doc);
      if (companions.length !== 1) {
        fail(
          `${doc}: ${key} requires exactly one ${spec.categoryCountMarker} companion marker, found ${companions.length}. `
          + `This table has ${table.rowsCounted} scoring rows, so add:\n`
          + `      <!-- doc-consistency: ${spec.categoryCountMarker}=${table.rowsCounted} -->\n`
          + '      next to the score marker. Without it the number of categories exists only in prose, '
          + 'and prose does not renumber itself when a row is added.'
        );
      } else if (Number(companions[0].value.trim()) !== table.rowsCounted) {
        fail(`${doc}: ${spec.categoryCountMarker}=${companions[0].value} but the rubric table has ${table.rowsCounted} scoring rows. Correct whichever is wrong — and check the prose, which usually spells this number out in words.`);
      } else {
        notes.push(`${spec.categoryCountMarker} = ${table.rowsCounted} scoring rows, matching the table`);
      }
    }

    // The ratchet. A published score may go up or stay put; it may not fall.
    if (spec.floorMarker) {
      const companions = (found.get(spec.floorMarker) || []).filter((entry) => entry.doc === doc);
      if (companions.length !== 1) {
        fail(
          `${doc}: ${key} requires exactly one ${spec.floorMarker} companion marker, found ${companions.length}. `
          + 'Without a floor there is no ratchet, and a headline score can be quietly lowered with nothing objecting. Add:\n'
          + `      <!-- doc-consistency: ${spec.floorMarker}=${table.totalRow.earned} -->\n`
          + '      🔴 The floor is per rubric. A NEW rubric id legitimately resets it (R3→R4 moved 653→355 with nothing regressing); '
          + 'the same rubric never does.'
        );
      } else {
        const floor = Number(/^(\d+)/.exec(companions[0].value.trim())?.[1] ?? NaN);
        if (!Number.isInteger(floor)) {
          fail(`${doc}: ${spec.floorMarker}=${companions[0].value} is not a whole number of points.`);
        } else if (table.totalRow.earned < floor) {
          fail(
            `${doc}: the published score ${table.totalRow.earned} is BELOW its recorded floor ${floor}. `
            + 'A demotion is recorded in the ledger, not in the headline: the headline stays at the floor and republishes '
            + 'at the next banking transaction whose net movement is non-negative. If the rubric itself changed, give it a '
            + `new rubric id and reset ${spec.floorMarker} in the same commit — never lower the floor to fit a lower score.`
          );
        } else {
          notes.push(`${key} ${table.totalRow.earned} is at or above its floor ${floor}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ledger markers: a row total that must be recounted, not trusted.
//
// 🔴 Written against the ledger's STRUCTURE, never against today's numbers. The
// document is expected to grow tiers and rows (a Mobile tier and reserve rows are
// in flight as this is written) and every count in here comes from the document
// itself: the marker supplies the expected total, the summary table supplies the
// per-tier breakdown, the tier tables supply the rows, and the Status Vocabulary
// table supplies the legal statuses and their credit weights. Hard-coding 130
// here would just move the unchecked number into the checker.
// ---------------------------------------------------------------------------
const splitRow = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
const isDividerRow = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
const plain = (cell) => String(cell ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();

const headingLevel = (line) => /^(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/** Lines belonging to the section that starts at `headingIndex`, up to the next heading. */
const sectionFrom = (lines, headingIndex) => {
  const out = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
};

/**
 * Lines belonging to a section INCLUDING its sub-sections, i.e. up to the next
 * heading at the same or a higher level.
 *
 * 🔴 Needed because a tier's rows are not necessarily one table. Tier 5 holds 72
 * rows in 23 tables under `### Family A…V` sub-headings. Reading only the first
 * table under the tier heading counted 2 of its 72 rows and reported the other 70
 * as a summary error — a checker bug that looks exactly like a document defect.
 */
const sectionWithSubsections = (lines, headingIndex) => {
  const level = headingLevel(lines[headingIndex]);
  const out = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const found = headingLevel(lines[i]);
    if (found > 0 && found <= level) break;
    out.push(lines[i]);
  }
  return out;
};

/** Every markdown table in a slice, each as its own array of cell-arrays. */
const allTables = (sectionLines) => {
  const tables = [];
  let current = null;
  for (const line of sectionLines) {
    if (!line.trimStart().startsWith('|')) {
      current = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length < 2 || isDividerRow(cells)) continue;
    if (!current) {
      current = [];
      tables.push(current);
    }
    current.push(cells);
  }
  return tables;
};

/** The first markdown table inside a section, as arrays of cells (divider dropped). */
const firstTable = (sectionLines) => allTables(sectionLines)[0] ?? [];

/**
 * How many ledger rows one table line represents.
 *
 * 🔴 A ledger line is not always one row. Both of these are in use and both must
 * be counted correctly, or the recount disagrees with the summary for a
 * formatting reason rather than a real one:
 *   `| 4.2–4.13 | ... | RENDERS ×12 |`  — a range with an explicit multiplier
 *   `| 3.1–3.4 | ... | OPEN ×4 |`
 * When a line carries both a range and a multiplier they must agree.
 */
const rowSpanFromLabel = (labelCell) => {
  const match = /^(\d+)\.(\d+)\s*[–—-]\s*(\d+)\.(\d+)$/.exec(plain(labelCell));
  if (!match || match[1] !== match[3]) return null;
  const span = Number(match[4]) - Number(match[2]) + 1;
  return span > 0 ? span : null;
};

/** Statuses and an optional `×N` multiplier out of one status cell. */
const parseStatusCell = (rawCell) => {
  // Parentheses hold qualifiers, not statuses: "RENDERS (unverified depth)".
  let text = plain(rawCell).replace(/\([^)]*\)/g, ' ');
  let multiplier = null;
  const times = /(?:×|✕|\bx)\s*(\d+)/i.exec(text);
  if (times) {
    multiplier = Number(times[1]);
    text = text.replace(times[0], ' ');
  }
  return { tokens: text.split(/[\s,]+/).filter(Boolean), multiplier };
};

/**
 * Read a journey ledger: its vocabulary, its summary table, and each tier's own
 * row table, recounted.
 */
const readJourneyLedger = (content) => {
  const lines = content.split(/\r?\n/);
  const errors = [];
  const headingIndex = (pattern) => lines.findIndex((line) => pattern.test(line));

  // --- Status Vocabulary: the only source of legal statuses and their weights.
  const vocabHeadingIndex = headingIndex(/^#{2,3}\s+Status Vocabulary\b/i);
  if (vocabHeadingIndex === -1) {
    return { errors: ['no "## Status Vocabulary" heading, so the checker has no list of legal statuses and no credit weights to recompute with'] };
  }
  const vocabRows = firstTable(sectionFrom(lines, vocabHeadingIndex));
  if (vocabRows.length < 2) return { errors: ['the Status Vocabulary section contains no table'] };
  const vocabHeader = vocabRows.shift();
  const creditIndex = vocabHeader.findIndex((cell) => /credit/i.test(cell));
  if (creditIndex === -1) {
    return { errors: ['the Status Vocabulary table has no Credit column, so per-tier credit cannot be recomputed from the rows'] };
  }

  /** @type {Map<string, {credit: number, excluded: boolean}>} */
  const vocabulary = new Map();
  for (const cells of vocabRows) {
    const name = plain(cells[0]);
    if (!name) continue;
    const raw = plain(cells[creditIndex] ?? '');
    const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
    const fraction = /^(?:0?\.\d+|[01](?:\.0+)?)$/.exec(raw);
    if (percent) vocabulary.set(name, { credit: Number(percent[1]) / 100, excluded: false });
    else if (fraction) vocabulary.set(name, { credit: Number(raw), excluded: false });
    else if (/excluded|out of scope|n\/?a/i.test(raw)) vocabulary.set(name, { credit: 0, excluded: true });
    else errors.push(`Status Vocabulary: cannot read a credit weight from ${JSON.stringify(raw)} for status ${name}. Use a percentage, a fraction, or the word "excluded".`);
  }
  if (vocabulary.size === 0) return { errors: ['the Status Vocabulary table defines no statuses'] };

  // --- Summary: the per-tier claim that the tier tables must justify.
  const summaryHeadingIndex = headingIndex(/^#{2,3}\s+Summary\b/i);
  if (summaryHeadingIndex === -1) return { errors: ['no "## Summary" heading, so there is no per-tier claim to check the tier tables against'], vocabulary };
  const summaryRows = firstTable(sectionFrom(lines, summaryHeadingIndex));
  if (summaryRows.length < 2) return { errors: ['the Summary section contains no table'], vocabulary };
  const summaryHeader = summaryRows.shift();
  const rowsColumn = summaryHeader.findIndex((cell) => /^rows$/i.test(plain(cell)));
  if (rowsColumn === -1) return { errors: ['the Summary table has no "Rows" column'], vocabulary };

  /** Status columns, each possibly a bucket of several statuses ("OPEN/BROKEN"). */
  const statusColumns = [];
  summaryHeader.forEach((cell, index) => {
    if (index <= rowsColumn) return;
    const tokens = plain(cell).split('/').map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    const known = tokens.filter((token) => vocabulary.has(token));
    if (known.length === tokens.length) {
      statusColumns.push({ index, label: plain(cell), statuses: tokens });
    } else if (known.length > 0) {
      errors.push(`Summary table: column ${JSON.stringify(plain(cell))} mixes statuses the vocabulary defines with ones it does not (${tokens.filter((t) => !vocabulary.has(t)).join(', ')}).`);
    }
  });
  for (const [name, spec] of vocabulary) {
    if (spec.excluded) continue;
    if (!statusColumns.some((column) => column.statuses.includes(name))) {
      errors.push(`Summary table: status ${name} has no column, so the number of ${name} rows is published nowhere and nothing can check it.`);
    }
  }

  // Optional: a published per-tier Credit column. If the document prints its own
  // arithmetic, the checker recomputes it rather than admiring it.
  const creditColumn = summaryHeader.findIndex((cell) => /^credit$/i.test(plain(cell)));

  const summary = [];
  let declaredTotal = null;
  for (const cells of summaryRows) {
    const label = plain(cells[0] ?? '');
    const rowCount = Number(plain(cells[rowsColumn] ?? '').replace(/,/g, ''));
    const counts = new Map();
    for (const column of statusColumns) counts.set(column.label, Number(plain(cells[column.index] ?? '')));
    const creditRaw = creditColumn === -1 ? '' : plain(cells[creditColumn] ?? '');
    const declaredCredit = /^\d*\.?\d+$/.test(creditRaw) ? Number(creditRaw) : null;
    if (/^\s*\*\*/.test(cells[0] ?? '')) {
      declaredTotal = { label, rows: rowCount, counts };
      continue;
    }
    const tierMatch = /(?:tier\s*)?(\d+)/i.exec(label);
    if (!tierMatch) {
      errors.push(`Summary table: row ${JSON.stringify(label)} names no tier number, so it cannot be matched to a "## Tier N" table. Number it, or make it the bold total row.`);
      continue;
    }
    if (!Number.isInteger(rowCount)) {
      errors.push(`Summary table: tier ${tierMatch[1]} has no readable row count.`);
      continue;
    }
    summary.push({ tier: Number(tierMatch[1]), label, rows: rowCount, counts, declaredCredit });
  }

  // --- Tier tables, recounted row by row.
  /** @type {Map<number, any>} */
  const tiers = new Map();
  lines.forEach((line, index) => {
    // 🔴 Level 2 only. Tier 5 contains a `### Tier 5 reserves (2 rows)`
    // sub-heading; matching `###` too made the checker report a duplicate tier
    // and skip the real one.
    const match = /^##\s+Tier\s+(\d+)\b/i.exec(line);
    if (!match) return;
    const tier = Number(match[1]);
    if (tiers.has(tier)) {
      errors.push(`two "## Tier ${tier}" headings exist; a tier number must be unique or its rows are counted twice.`);
      return;
    }
    // Every table under the tier heading, sub-sections included.
    const tables = allTables(sectionWithSubsections(lines, index))
      .map((table) => {
        const header = table[0] ?? [];
        const statusIndex = header.findIndex((cell) => /status/i.test(cell));
        return { statusIndex, rows: table.slice(1) };
      })
      .filter((table) => table.statusIndex !== -1);

    if (tables.length === 0) {
      errors.push(`Tier ${tier}: no table with a Status column under its heading, so its summary counts rest on nothing.`);
      return;
    }

    const counts = new Map();
    let rows = 0;
    let excludedRows = 0;
    let creditNumerator = 0;

    for (const { statusIndex, rows: tableRows } of tables) {
      for (const cells of tableRows) {
        const label = plain(cells[0] ?? '') || '(unlabelled)';
        const { tokens, multiplier } = parseStatusCell(cells[statusIndex] ?? '');
        if (tokens.length === 0) {
          errors.push(`Tier ${tier} row ${label}: empty Status cell. Every row carries a status; "not started" is OPEN.`);
          continue;
        }
        const unknown = tokens.filter((token) => !vocabulary.has(token));
        if (unknown.length > 0) {
          errors.push(
            `Tier ${tier} row ${label}: status ${unknown.join(', ')} is not defined in this ledger's own Status Vocabulary table `
            + `(legal: ${[...vocabulary.keys()].join(', ')}). A status with no vocabulary entry has no credit weight, so the `
            + 'category score computed from it is a guess. Pick one status; if the row is between two states, use the lower one '
            + 'and say why in the evidence column.'
          );
          continue;
        }
        if (tokens.length > 1) {
          errors.push(`Tier ${tier} row ${label}: Status reads "${tokens.join(' ')}" — a row carries exactly one status.`);
          continue;
        }
        const span = rowSpanFromLabel(cells[0] ?? '');
        if (multiplier !== null && span !== null && multiplier !== span) {
          errors.push(`Tier ${tier} row ${label}: the label covers ${span} rows but the status says ×${multiplier}.`);
        }
        const count = multiplier ?? span ?? 1;
        const status = tokens[0];
        const spec = vocabulary.get(status);
        counts.set(status, (counts.get(status) ?? 0) + count);
        rows += count;
        if (spec.excluded) excludedRows += count;
        else creditNumerator += count * spec.credit;
      }
    }

    const denominator = rows - excludedRows;
    tiers.set(tier, {
      tier,
      rows,
      counts,
      excludedRows,
      creditNumerator,
      denominator,
      credit: denominator > 0 ? creditNumerator / denominator : 0
    });
  });

  return { vocabulary, statusColumns, summary, declaredTotal, tiers, errors };
};

/** The parsed ASP.NET ledger, reused by the category assertions below. */
let aspnetLedger = null;

for (const [key, occurrences] of found) {
  const spec = KNOWN_MARKERS[key];
  if (spec.kind !== 'ledger') continue;

  for (const { value, doc } of occurrences) {
    const declaredRows = Number(value.trim());
    if (!Number.isInteger(declaredRows)) {
      fail(`${doc}: ${key}=${value} is not a whole number of rows.`);
      continue;
    }

    const content = read(spec.doc);
    if (content === null) continue;

    const ledger = readJourneyLedger(content);
    for (const error of ledger.errors) fail(`${spec.doc}: ${error}`);
    if (!ledger.tiers || ledger.tiers.size === 0) {
      fail(`${spec.doc}: no "## Tier N" row tables found, so ${key}=${declaredRows} is checked against nothing.`);
      continue;
    }
    if (key === 'ASPNET_JOURNEY_ROWS') aspnetLedger = ledger;

    // (c) A tier's summary line must equal what its own table contains.
    let summedRows = 0;
    for (const entry of ledger.summary) {
      const tier = ledger.tiers.get(entry.tier);
      if (!tier) {
        fail(`${spec.doc}: the Summary table declares tier ${entry.tier} but there is no "## Tier ${entry.tier}" row table to count. A summary line with no table behind it is exactly the unchecked number this file exists to stop.`);
        continue;
      }
      summedRows += entry.rows;
      if (entry.rows !== tier.rows) {
        fail(`${spec.doc}: tier ${entry.tier} summary says ${entry.rows} rows but its own table counts ${tier.rows}. The table is the record — correct the summary, and check for a row range whose ×N no longer matches its label.`);
      }
      for (const column of ledger.statusColumns) {
        const claimed = entry.counts.get(column.label);
        const counted = column.statuses.reduce((sum, status) => sum + (tier.counts.get(status) ?? 0), 0);
        if (claimed !== counted) {
          fail(`${spec.doc}: tier ${entry.tier} summary claims ${claimed} ${column.label} but its own rows count ${counted}. Every category score is computed from these counts, so a wrong one silently moves the published score.`);
        }
      }
      // A published credit is arithmetic, and arithmetic in prose goes stale.
      if (entry.declaredCredit !== null && Math.abs(entry.declaredCredit - tier.credit) > 0.001) {
        fail(`${spec.doc}: tier ${entry.tier} publishes credit ${entry.declaredCredit.toFixed(3)} but its rows recompute to ${tier.credit.toFixed(3)}. The rows are the record.`);
      }
    }
    for (const tier of ledger.tiers.keys()) {
      if (!ledger.summary.some((entry) => entry.tier === tier)) {
        fail(`${spec.doc}: "## Tier ${tier}" has a row table but no Summary line, so its ${ledger.tiers.get(tier).rows} rows are excluded from every total.`);
      }
    }

    // (d) The per-tier totals must sum to the marker, and to the document's own
    // bold total row.
    if (summedRows !== declaredRows) {
      fail(`${spec.doc}: marker ${key}=${declaredRows} but the per-tier row totals sum to ${summedRows}. 🔴 The ledger is the record: correct the marker, never the tier tables.`);
    }
    if (ledger.declaredTotal && ledger.declaredTotal.rows !== declaredRows) {
      fail(`${spec.doc}: the Summary total row says ${ledger.declaredTotal.rows} rows but marker ${key}=${declaredRows}.`);
    }
    if (ledger.declaredTotal) {
      for (const column of ledger.statusColumns) {
        const claimed = ledger.declaredTotal.counts.get(column.label);
        const counted = [...ledger.tiers.values()].reduce(
          (sum, tier) => sum + column.statuses.reduce((inner, status) => inner + (tier.counts.get(status) ?? 0), 0),
          0
        );
        if (claimed !== counted) {
          fail(`${spec.doc}: the Summary total row claims ${claimed} ${column.label} but the tier tables contain ${counted}.`);
        }
      }
    }

    // (f) Report the recomputed credit per tier. Reported only — the numbers the
    // score is actually published from are asserted against the status document
    // in the next section.
    for (const tier of [...ledger.tiers.values()].sort((a, b) => a.tier - b.tier)) {
      const breakdown = [...tier.counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${count}×${status}`)
        .join(' + ') || 'no rows';
      notes.push(
        `ledger tier ${tier.tier}: ${tier.rows} rows (${breakdown})`
        + `${tier.excludedRows > 0 ? `, ${tier.excludedRows} excluded` : ''}`
        + ` → recomputed credit ${tier.credit.toFixed(3)}`
      );
    }
    notes.push(`${key} = ${declaredRows} rows across ${ledger.tiers.size} tier table(s), recounted`);
  }
}

// ---------------------------------------------------------------------------
// Journey categories in the ASP.NET status document must equal the credit
// recomputed from the ledger rows.
//
// 🔴 The status document states that the journey categories are "computed
// mechanically from the ledger using its published credit weights, so the score
// moves when and only when a ledger row moves". Nothing enforced that. Four
// numbers totalling 112 points were arithmetic performed by hand, in prose, in a
// different file from the rows they came from.
//
// Mapping is explicit and deliberately small. A journey category this table
// cannot resolve is a FAILURE, not a skip: silently skipping is how the previous
// version of this checker ended up asserting nothing at all.
// ---------------------------------------------------------------------------
const ASPNET_JOURNEY_CATEGORY_TIERS = [
  { match: /core member journeys/i, tiers: [1], why: 'Tier 1 — core member journeys (React)' },
  // One category covers two tiers: community AND extended modules share a weight.
  { match: /community and extended module/i, tiers: [2, 3], why: 'Tiers 2+3 — community and extended module journeys (React)' },
  { match: /web uk/i, tiers: [4], why: 'Tier 4 — Web UK accessible member journeys' },
  { match: /staff journeys/i, tiers: [5], why: 'Tier 5 — staff journeys (admin / super-admin / broker)' },
  // Registered ahead of the tier existing, because a Mobile tier is in flight.
  // Harmless while no such category row exists.
  { match: /mobile/i, tiers: [6], why: 'Tier 6 — mobile journeys' }
];

const aspnetScore = rubricTables.get('ASPNET_CURRENT_BANKED_SCORE');
if (aspnetScore && aspnetScore.table.scoringRows) {
  if (!aspnetLedger) {
    fail(`${aspnetScore.doc}: the journey categories are derived from aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md, but that ledger could not be parsed, so none of them was checked.`);
  } else {
    for (const row of aspnetScore.table.scoringRows) {
      if (!/journey/i.test(row.name)) continue; // non-journey categories are not ledger-derived
      const mapping = ASPNET_JOURNEY_CATEGORY_TIERS.find((entry) => entry.match.test(row.name));
      if (!mapping) {
        fail(
          `${aspnetScore.doc}: journey category ${JSON.stringify(row.name)} cannot be mapped to any ledger tier, so its `
          + `${row.earned} points are unchecked. Add an entry to ASPNET_JOURNEY_CATEGORY_TIERS in scripts/check-doc-scores.mjs `
          + 'naming the tier(s) it is computed from. Do not leave it unmapped — an unmapped journey category is a hand-computed '
          + 'number in a document that claims the number is mechanical.'
        );
        continue;
      }
      const missing = mapping.tiers.filter((tier) => !aspnetLedger.tiers.has(tier));
      if (missing.length > 0) {
        fail(`${aspnetScore.doc}: journey category ${JSON.stringify(row.name)} is mapped to ledger tier(s) ${missing.join(', ')}, which the ledger does not contain (${mapping.why}). Fix the mapping or the tier numbering.`);
        continue;
      }
      if (row.maximum === null) {
        fail(`${aspnetScore.doc}: journey category ${JSON.stringify(row.name)} has no Maximum, so its weight is unknown and the ledger credit cannot be applied to it.`);
        continue;
      }

      let numerator = 0;
      let denominator = 0;
      for (const tierNumber of mapping.tiers) {
        const tier = aspnetLedger.tiers.get(tierNumber);
        numerator += tier.creditNumerator;
        denominator += tier.denominator;
      }
      if (denominator === 0) {
        fail(`${aspnetScore.doc}: journey category ${JSON.stringify(row.name)} maps to tier(s) ${mapping.tiers.join('+')} with no countable rows.`);
        continue;
      }

      const credit = numerator / denominator;
      const expected = Math.round(row.maximum * credit);
      // ±1 absorbs the rounding the document performs by hand; anything larger is
      // arithmetic that no longer follows the rows.
      if (Math.abs(expected - row.earned) > 1) {
        fail(
          `${aspnetScore.doc}: journey category ${JSON.stringify(row.name)} is banked at ${row.earned}/${row.maximum}, `
          + `but ${mapping.why} recomputes to credit ${credit.toFixed(4)} → ${expected}/${row.maximum}. `
          + '🔴 The ledger rows are the record. Either a ledger row moved without the score being rebanked, or the score '
          + 'was written by hand. Recompute from the rows; never adjust the rows to match a published number.'
        );
      } else {
        notes.push(`ASP.NET category ${JSON.stringify(row.name)} = ${row.earned}/${row.maximum}, ledger recomputes ${expected}/${row.maximum} (credit ${credit.toFixed(4)}, ${mapping.why})`);
      }
    }
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
// The migration count a document quotes must be the migrations on disk.
//
// 🔴 This marker was `opaque`, and it was wrong: it read 183 while the tree held
// 184. That is the cheapest possible class of doc drift — the answer is a
// directory listing — and it survived because nothing looked. The checker
// deliberately does NOT rewrite the marker: the document owner corrects the
// document, and the checker's only job is to make the disagreement impossible to
// miss.
// ---------------------------------------------------------------------------
const countEfMigrations = () => {
  const roots = [];
  const findMigrationDirs = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
      const full = join(absolute, entry.name);
      if (entry.name === 'Migrations') roots.push(full);
      findMigrationDirs(full);
    }
  };
  const src = join(ROOT, 'aspnet-backend', 'src');
  if (!existsSync(src)) return null;
  findMigrationDirs(src);

  let count = 0;
  for (const dir of roots) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.cs')) continue;
      // A migration is the one file per migration that is neither the generated
      // designer partial nor the single rolling model snapshot.
      if (entry.name.endsWith('.Designer.cs')) continue;
      if (/ModelSnapshot\.cs$/.test(entry.name)) continue;
      count += 1;
    }
  }
  return { count, dirs: roots.map((dir) => relative(ROOT, dir).split(sep).join('/')) };
};

for (const { value, doc } of found.get('SCHEMA_CURRENT_RUNTIME_MIGRATIONS') || []) {
  const declared = Number(/^(\d+)/.exec(value.trim())?.[1] ?? NaN);
  const actual = countEfMigrations();
  if (actual === null) {
    fail(`${doc}: SCHEMA_CURRENT_RUNTIME_MIGRATIONS=${value} cannot be checked — aspnet-backend/src does not exist in this checkout.`);
  } else if (!Number.isInteger(declared)) {
    fail(`${doc}: SCHEMA_CURRENT_RUNTIME_MIGRATIONS=${value} is not a whole number.`);
  } else if (declared !== actual.count) {
    fail(
      `${doc}: SCHEMA_CURRENT_RUNTIME_MIGRATIONS=${declared} but ${actual.count} EF migrations exist on disk `
      + `(counted in ${actual.dirs.join(', ') || 'no Migrations directory'}, excluding *.Designer.cs and *ModelSnapshot.cs). `
      + '🔴 The tree is the truth. Correct the document — and any prose that repeats the old number — rather than editing this '
      + 'marker to whatever makes the check pass.'
    );
  } else {
    notes.push(`SCHEMA_CURRENT_RUNTIME_MIGRATIONS = ${declared}, matching the migrations on disk`);
  }
}

// ---------------------------------------------------------------------------
// Retired score literals must not appear in maintained Markdown.
//
// 🔴 A retired score in a maintained document is worse than no score: readers and
// agents quote the first number they find, and three superseded ASP.NET totals
// (712, 598, 653) plus three superseded rubric ids are still loose in the tree.
// R1–R3 measured API surface; R4 measures proved journeys. They are not
// comparable, so a stray "653/1000" invites exactly the subtraction the status
// document forbids in bold.
//
// History is preserved, not deleted: HISTORY/, the changelogs, and any file that
// declares itself historical at the top are all allowed to hold these literals.
// ---------------------------------------------------------------------------
const RETIRED_LITERALS = [
  { pattern: /712\/1000/, label: '712/1000 (Baseline 1, pre-drift denominator)' },
  { pattern: /598\/1000/, label: '598/1000 (Baseline 2, ASPNET-CONTRACT-R2)' },
  { pattern: /653\/1000/, label: '653/1000 (Baseline 3, ASPNET-CONTRACT-R3)' },
  { pattern: /ASPNET-CONTRACT-R[123]\b/, label: 'a retired rubric id (ASPNET-CONTRACT-R1/R2/R3)' }
];

/** Files and trees where a retired literal is legitimate. */
const isHistoricalLocation = (relativePosix) => {
  if (relativePosix.split('/').includes('HISTORY')) return true;
  // 🔴 The rubric registry is the ONE maintained document whose job is to name
  // every baseline that ever existed, with its denominator, so a later reader can
  // tell which question a historical number answered. Banning retired literals
  // here would force the registry to stop registering. It is exempt for that
  // reason and no other: it DEFINES baselines, it never presents one as current,
  // and governance already forbids it from publishing a live score.
  if (relativePosix === 'aspnet-backend/docs/FULL_PARITY_REMEDIATION_RUNBOOK.md') return true;
  if (relativePosix === 'CHANGELOG.md') return true;
  if (relativePosix.endsWith('/CHANGELOG.md')) return true;
  if (relativePosix === 'react-frontend/public/changelog.md') return true;
  if (relativePosix.startsWith('react-frontend/dist/')) return true;
  return false;
};

/**
 * A file that declares ITSELF historical is exempt.
 *
 * 🔴 Tightened 2026-08-21. The first version tested the opening 30 lines for
 * /historical checkpoint|superseded|retired/ anywhere, which exempted any file
 * that merely MENTIONED a retired sibling. Measured: it exempted
 * web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md — a fully maintained, canonical
 * current score document — because its intro explains that W1 "is retired and
 * kept as the W1 audit trail". A maintained document silently exempted from the
 * stale-score scan is precisely the hole this scan exists to close.
 *
 * The declaration must now be ABOUT THIS FILE, which in this repository means one
 * of two conventions:
 *   - a `Status:` line (optionally inside a blockquote) whose value says
 *     historical / superseded / retired — the governance state-label convention; or
 *   - an explicit "Historical checkpoint" banner, which governance already
 *     requires such files to carry near the title.
 * Prose about some other document no longer buys an exemption.
 */
const declaresItselfHistorical = (text) => {
  const head = text.split(/\r?\n/).slice(0, 30);
  return head.some((line) =>
    /^\s*>?\s*(?:\*\*)?Status(?:\*\*)?\s*:.*(historical|superseded|retired)/i.test(line)
    || /historical checkpoint/i.test(line));
};

const scanRetiredLiterals = () => {
  const SKIP_DIRS = new Set([
    'node_modules', 'vendor', '.git', '.local-docs-archive', '.heroui-docs',
    'site', 'coverage', 'storage'
  ]);
  let scanned = 0;

  const walk = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(absolute, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;

      const full = join(absolute, entry.name);
      const relativePosix = relative(ROOT, full).split(sep).join('/');
      if (isHistoricalLocation(relativePosix)) continue;

      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      scanned += 1;
      if (declaresItselfHistorical(text)) continue;

      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const { pattern, label } of RETIRED_LITERALS) {
          if (!pattern.test(line)) continue;
          fail(
            `${relativePosix}:${index + 1}: quotes ${label} in maintained documentation. `
            + 'Move it under HISTORY/, or mark this file historical/superseded/retired in its opening lines. '
            + 'R1–R3 and R4 measure different things and must never be compared, subtracted or averaged.'
          );
        }
      });
    }
  };

  walk(ROOT);
  notes.push(`retired-literal scan: ${scanned} maintained Markdown file(s) checked`);
};

scanRetiredLiterals();

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('check-doc-scores FAILED\n');
  for (const message of failures) console.error(`  - ${message}`);
  // 🔴 Print what DID verify, even on failure. The recomputed ledger credits are
  // the numbers a reader needs in order to fix a score mismatch, and hiding them
  // behind a green run is how a failure becomes guesswork.
  if (notes.length > 0) {
    console.error('\nVerified / recomputed along the way:');
    for (const note of notes) console.error(`  · ${note}`);
  }
  console.error(`\n${failures.length} problem(s). 🔴 The generated artefacts are the truth; correct the document, not the evidence.`);
  process.exit(1);
}

console.log(`check-doc-scores OK — ${found.size} marker key(s) across ${MARKER_DOCUMENTS.length} document(s).`);
for (const note of notes) console.log(`  - ${note}`);
