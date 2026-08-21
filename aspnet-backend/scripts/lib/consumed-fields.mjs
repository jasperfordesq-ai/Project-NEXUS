// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Consumed-field classification: decide whether a differing response field is
 * ADR-0004 in scope, out of scope, or genuinely undecidable.
 *
 * 🔴 The rule this implements. ADR-0004: "a response field is in scope only if a
 * client reads it, acts on it, or its difference changes an outcome. A field with
 * no reader is OUT of scope." Under a whole-body diff, Laravel's raw-Eloquent
 * internal columns counted as required work — that is how "80 of 195 read
 * responses differ" came to be a published UPPER BOUND rather than a defect
 * count.
 *
 * 🔴 THREE BUCKETS, AND THE THIRD IS NOT OPTIONAL.
 *
 *   IN_SCOPE      a client reads this field. A real defect candidate.
 *   OUT_OF_SCOPE  no reader found in any client or published contract. Recorded
 *                 with a count and moved past — NEVER silently dropped, because
 *                 the count is the evidence that the reduction was honest.
 *   UNKNOWN       the scan could not decide. Treated AS IN SCOPE, and labelled,
 *                 because rounding "cannot tell" down to "nothing reads it" is
 *                 how the starts_at / start_date defect hid behind HTTP 200s.
 *
 * 🔴 Never invert the bias. A false IN_SCOPE costs an investigation. A false
 * OUT_OF_SCOPE hides a defect. Every judgement below leans towards in scope.
 */

import fs from 'node:fs';

/**
 * Path segments that say nothing about which object a field hangs off.
 * `data`, `meta` and friends are envelope furniture, so a field under them has
 * no informative parent and the co-location test cannot be applied. Those
 * fields get the benefit of the doubt and are treated as IN_SCOPE on a name
 * match alone — they are also the fields most likely to be read directly.
 */
const ENVELOPE_SEGMENTS = new Set([
  'data', 'meta', 'result', 'results', 'payload', 'items', 'attributes',
  'links', 'response', 'body',
]);

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]+$/;

/** Load a manifest and build the lookup structures the classifier needs. */
function loadManifest(manifestPath) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const names = raw.names ?? {};

  // 🔴 Secondary NORMALISED index: Laravel answers snake_case and a .NET
  // serialiser can answer camelCase for the same field. Matching only the exact
  // spelling would mark `startDate` unread while `start_date` is read on every
  // events screen — a false OUT_OF_SCOPE, the expensive direction.
  const normalised = new Map();
  for (const name of Object.keys(names)) {
    const key = name.replace(/_/g, '').toLowerCase();
    if (!normalised.has(key)) normalised.set(key, name);
  }

  return {
    meta: {
      generated_at: raw.generated_at,
      repo_sha: raw.repo_sha,
      unique_names: raw.counts?.unique_names ?? Object.keys(names).length,
      clients: (raw.clients ?? []).map((c) => c.id),
      path: manifestPath,
    },
    names,
    normalised,
    files: raw.files ?? [],
  };
}

const leafOf = (fieldPath) => fieldPath.split('.').pop().replace(/\[\]$/, '');

const informativeParents = (fieldPath) => fieldPath
  .split('.')
  .slice(0, -1)
  .map((s) => s.replace(/\[\]$/, ''))
  .filter((s) => s && !ENVELOPE_SEGMENTS.has(s) && IDENTIFIER_RE.test(s));

/** Does `entry` share a source file with any of the parent names? */
function coLocated(manifest, entry, parents) {
  if (entry.ubiquitous) return true; // See UBIQUITOUS_FILE_COUNT in the generator.
  const own = entry.files;
  if (!own || own.length === 0) return false;
  const ownSet = new Set(own);
  for (const parent of parents) {
    const parentEntry = manifest.names[parent];
    if (!parentEntry) continue;
    if (parentEntry.ubiquitous) return true;
    for (const id of parentEntry.files ?? []) if (ownSet.has(id)) return true;
  }
  return false;
}

/** First evidence site per client, for the report. */
function evidenceFor(entry) {
  const out = [];
  for (const [client, sites] of Object.entries(entry.sites ?? {})) {
    if (sites.length) out.push(`${client} ${sites[0]}`);
  }
  return out;
}

/**
 * Classify one differing field path.
 *
 * @returns {{bucket: 'IN_SCOPE'|'OUT_OF_SCOPE'|'UNKNOWN', reason: string,
 *            leaf: string, readers: string[], evidence: string[]}}
 */
function classifyFieldPath(fieldPath, manifest) {
  const leaf = leafOf(fieldPath);

  // Depth-capped nodes: response-shape.mjs truncates at depth 6 with '…', so
  // the real field name is not even visible here. Undecidable, not unread.
  if (fieldPath.includes('…')) {
    return { bucket: 'UNKNOWN', reason: 'path truncated by the depth cap', leaf, readers: [], evidence: [] };
  }

  // Dynamic map keys — numeric ids, hyphenated slugs, locale codes. A client
  // reads these with a variable subscript, which no static scan can see, so
  // "not in the manifest" tells us nothing at all about them.
  if (!IDENTIFIER_RE.test(leaf)) {
    return {
      bucket: 'UNKNOWN',
      reason: 'key is not a static identifier (dynamic map key); a static scan cannot see its reader',
      leaf,
      readers: [],
      evidence: [],
    };
  }

  let entry = manifest.names[leaf];
  let matchMode = 'exact';
  if (!entry) {
    const alias = manifest.normalised.get(leaf.replace(/_/g, '').toLowerCase());
    if (alias) { entry = manifest.names[alias]; matchMode = `normalised (${alias})`; }
  }

  if (!entry) {
    return {
      bucket: 'OUT_OF_SCOPE',
      reason: 'no reader in react, web-uk, mobile, or the published OpenAPI contract',
      leaf,
      readers: [],
      evidence: [],
    };
  }

  const readers = Object.keys(entry.clients ?? {});
  const evidence = evidenceFor(entry);
  const parents = informativeParents(fieldPath);

  if (parents.length === 0) {
    return {
      bucket: 'IN_SCOPE',
      reason: `read by ${readers.join(', ')} (${matchMode}); no informative parent, so the name match stands`,
      leaf,
      readers,
      evidence,
    };
  }

  if (coLocated(manifest, entry, parents)) {
    return {
      bucket: 'IN_SCOPE',
      reason: `read by ${readers.join(', ')} (${matchMode}) in the same file as ${parents[parents.length - 1]}`,
      leaf,
      readers,
      evidence,
    };
  }

  // The name IS read somewhere, but never beside the object it hangs off here.
  // That is how `showcased_badges[].msg` matched `.msg` in the messages
  // conversation page. Weak evidence, so UNKNOWN — still counted as in scope.
  return {
    bucket: 'UNKNOWN',
    reason: `name read by ${readers.join(', ')} but never in the same file as ${parents.join('/')}`
      + ' — could be a different object of the same field name',
    leaf,
    readers,
    evidence,
  };
}

/**
 * Paths whose ANCESTOR was an empty array on one side.
 *
 * 🔴 An empty list inflates the missing-field count with every child field of
 * the rows it did not contain. `fieldPaths()` walks the first element of an
 * array, so when Laravel returns three badges and ASP.NET returns `[]`, every
 * field of the rows it did not contain is reported "missing in ASP.NET" — when
 * what is actually missing is a fixture row. Measured on
 * /api/v2/gamification/profile: 28 of its 64 "missing" fields were children of
 * one empty list, and 58 of the whole corpus's 116 UNKNOWN.
 *
 * These are UNKNOWN, never OUT_OF_SCOPE and never a defect: the contract of
 * those rows was not tested at all. This mirrors the MATCH_BUT_LIST_EMPTY
 * verdict the classifier already applies at whole-response level.
 */
function emptyListPrefixes(value, prefix = '', depth = 0, out = new Set()) {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length === 0) out.add(`${prefix}[]`);
    else emptyListPrefixes(value[0], `${prefix}[]`, depth + 1, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    emptyListPrefixes(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  }
  return out;
}

const underEmptyList = (fieldPath, prefixes) => {
  for (const p of prefixes) if (fieldPath.startsWith(`${p}.`)) return true;
  return false;
};

/**
 * Bucket every differing field path of one endpoint.
 *
 * @param {object} diff        { missing_in_aspnet, extra_in_aspnet }
 * @param {object} bodies      { laravel, aspnet } parsed response bodies
 * @param {object} manifest    from loadManifest()
 */
function bucketEndpoint(diff, bodies, manifest) {
  const emptyOnEitherSide = new Set([
    ...emptyListPrefixes(bodies.laravel),
    ...emptyListPrefixes(bodies.aspnet),
  ]);

  const buckets = { IN_SCOPE: [], OUT_OF_SCOPE: [], UNKNOWN: [] };

  const add = (fieldPath, direction) => {
    let verdict;
    if (underEmptyList(fieldPath, emptyOnEitherSide)) {
      verdict = {
        bucket: 'UNKNOWN',
        reason: 'child of a list that was EMPTY on one side — the row contract was never tested',
        leaf: leafOf(fieldPath),
        readers: [],
        evidence: [],
      };
    } else {
      verdict = classifyFieldPath(fieldPath, manifest);
    }
    buckets[verdict.bucket].push({ path: fieldPath, direction, ...verdict });
  };

  // 🔴 THE SHAPES DIFFER BUT NO FIELD PATH DOES — a TYPE change on a path both
  // sides carry, which `describeShapeDiff` cannot name because it compares
  // presence, not types. The first version of this function cleared such an
  // endpoint as OUT_OF_SCOPE_ONLY, which is a FALSE CLEAN in exactly the
  // direction that hides defects: measured on /api/v2/groups/form-capabilities,
  // 0 missing and 0 extra with the skeletons still disagreeing.
  //
  // It becomes UNKNOWN, which is treated as in scope. Naming the field would
  // need per-path type diffing; until that exists, the endpoint must not read as
  // clean.
  const noPaths = (diff.missing_in_aspnet ?? []).length === 0
    && (diff.extra_in_aspnet ?? []).length === 0;
  if (noPaths) {
    buckets.UNKNOWN.push({
      path: '(whole response)',
      direction: 'missing_in_aspnet',
      bucket: 'UNKNOWN',
      reason: 'shapes differ but no field path does — a TYPE difference on a shared path,'
        + ' which the field-presence diff cannot name. Read both responses.',
      leaf: '',
      readers: [],
      evidence: [],
    });
  }

  for (const f of diff.missing_in_aspnet ?? []) add(f, 'missing_in_aspnet');
  // 🔴 Extra fields are reported too, but ADR-0004 is explicit that a SUPERSET
  // is not a gap: "Where ASP.NET returns a superset of what a client reads,
  // that is not a gap." They are carried so the count stays honest, never as
  // defects. Consumers must not add them to a work queue.
  for (const f of diff.extra_in_aspnet ?? []) add(f, 'extra_in_aspnet');

  const missing = (bucket) => buckets[bucket].filter((f) => f.direction === 'missing_in_aspnet');
  const extra = (bucket) => buckets[bucket].filter((f) => f.direction === 'extra_in_aspnet');
  const inScopeMissing = missing('IN_SCOPE');
  const unknownMissing = missing('UNKNOWN');

  // 🔴 Counts are DIRECTION-AWARE, and the first version of this was not.
  // It reported "1 in scope" on an endpoint whose only in-scope difference was
  // a field ASP.NET returns and Laravel does not — printed next to the verdict
  // OUT_OF_SCOPE_ONLY, which reads like a contradiction and invites someone to
  // "fix" a superset. ADR-0004: "Where ASP.NET returns a superset of what a
  // client reads, that is not a gap." Extras are counted, never queued.
  return {
    buckets,
    counts: {
      in_scope: inScopeMissing.length,
      out_of_scope: missing('OUT_OF_SCOPE').length,
      unknown: unknownMissing.length,
      in_scope_missing: inScopeMissing.length,
      unknown_missing: unknownMissing.length,
      extra_in_aspnet: extra('IN_SCOPE').length + extra('UNKNOWN').length + extra('OUT_OF_SCOPE').length,
      extra_read_by_a_client: extra('IN_SCOPE').length,
    },
    // A defect candidate needs a field a client READS that ASP.NET does not
    // send. Extras never qualify; UNKNOWN counts, because it is in scope.
    is_defect_candidate: inScopeMissing.length > 0 || unknownMissing.length > 0,
  };
}

export {
  loadManifest, classifyFieldPath, bucketEndpoint, emptyListPrefixes,
  leafOf, informativeParents, ENVELOPE_SEGMENTS,
};
