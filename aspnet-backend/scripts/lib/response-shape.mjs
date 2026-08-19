// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Response-shape comparison, shared by the READ harness
 * (compare-live-responses.mjs) and the WRITE harness (compare-live-writes.mjs).
 *
 * 🔴 Extracted rather than copied. Two copies would drift, and the rules in here
 * were each earned the hard way: the empty-list verdict, the null rule, and the
 * tautological-guard fix all cost a measurement cycle. One implementation means a
 * correction lands for both harnesses at once.
 */

/**
 * Reduce a JSON value to a type skeleton: field names and types, no values.
 * Arrays collapse to the skeleton of their first element, because a list of 3
 * and a list of 40 are the same contract.
 */
/** Marker for a list whose element contract cannot be read because it is empty. */
const UNKNOWN_LIST = '[?]';

function skeleton(value, depth = 0) {
  if (depth > 6) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    // 🔴 An empty list is UNKNOWN, not "a list of nothing". The two backends
    // hold different data — Laravel local is a production-derived snapshot and
    // ASP.NET has a thin demo seed — so one side routinely has rows where the
    // other has none. Collapsing `[]` to a comparable skeleton made every such
    // endpoint look like a field-name mismatch (`/api/v2/blog/categories`
    // reported six invented "extra" fields that were only ASP.NET having rows).
    // Marking it UNKNOWN lets the comparison say "cannot tell" instead of
    // guessing in either direction.
    return value.length === 0 ? UNKNOWN_LIST : `[${skeleton(value[0], depth + 1)}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${k}:${skeleton(value[k], depth + 1)}`).join(',')}}`;
  }
  return typeof value;
}

/** Field paths present in a skeleton, for a readable diff. */
function fieldPaths(value, prefix = '', depth = 0, out = new Set()) {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length > 0) fieldPaths(value[0], `${prefix}[]`, depth + 1, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    fieldPaths(v, p, depth + 1, out);
  }
  return out;
}

/**
 * Split an object skeleton `{a:…,b:…}` into a field → skeleton map, respecting
 * nesting so a comma inside a child does not split the parent.
 */
function splitObject(s) {
  const out = new Map();
  let depth = 0;
  let start = 1;
  const push = (end) => {
    const part = s.slice(start, end);
    if (!part) return;
    const colon = part.indexOf(':');
    out.set(part.slice(0, colon), part.slice(colon + 1));
  };
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) { push(i); break; }
      depth--;
    } else if (c === ',' && depth === 0) { push(i); start = i + 1; }
  }
  return out;
}

/**
 * Compare two skeletons: 'same' | 'unknown' | 'different'.
 *
 * 'unknown' means everything visible agrees but at least one list was empty, so
 * the contract of its rows was never actually tested.
 */
function compareSkeleton(a, b) {
  if (a === UNKNOWN_LIST || b === UNKNOWN_LIST) {
    // 🔴 This guard used to read
    //     a === b || a.startsWith('[') || b.startsWith('[')
    // which is ALWAYS TRUE, because UNKNOWN_LIST is the literal '[?]' and that
    // always starts with '['. So once either side was an empty list the function
    // could never return 'different', whatever the other side held.
    //
    // The consequence was not theoretical. Where Laravel returns an OBJECT and
    // ASP.NET returns a LIST, the verdict came out MATCH_BUT_LIST_EMPTY instead of
    // a difference — measured on /coupons, /jobs/my-applications, /me/verein-dues,
    // /volunteering/donations and /volunteering/training, all of which had Laravel
    // on {data:{items:[…]}} against ASP.NET's {data:[…]}. Those are envelope
    // divergences a client breaks on, sitting in the "nothing to see here" column.
    //
    // An empty list is genuinely UNKNOWN only against another list: neither side
    // can show its row contract. Against anything else the two disagree about the
    // SHAPE, which is knowable and is a difference.
    const other = a === UNKNOWN_LIST ? b : a;
    if (a === b) return 'unknown';
    if (other.startsWith('[')) return 'unknown';
    // A list on one side and null on the other stays 'unknown' rather than
    // 'different': that is the same nullable-field ambiguity handled below, and
    // calling it a defect would invent one from a single sample.
    if (other === 'null') return 'unknown';
    return 'different';
  }
  if (a === b) return 'same';

  // 🔴 A null on ONE side is unknown for the same reason an empty list is: the
  // field is nullable and this row happens not to have a value. `categories`
  // reported a mismatch purely because the Laravel snapshot's first row had
  // been edited (`updated_at` a string) and the demo row had not (null).
  // Two nulls are identical output and compare equal above.
  //
  // This is the one place the harness can hide a real defect — a field ASP.NET
  // ALWAYS returns null while Laravel always populates it looks the same from
  // one sample. It is reported as unknown rather than as a pass so a human
  // still sees it; it is never counted as identical.
  if (a === 'null' || b === 'null') return 'unknown';

  const isList = (s) => s.startsWith('[') && s.endsWith(']');
  if (isList(a) && isList(b)) return compareSkeleton(a.slice(1, -1), b.slice(1, -1));

  const isObj = (s) => s.startsWith('{') && s.endsWith('}');
  if (isObj(a) && isObj(b)) {
    const fa = splitObject(a);
    const fb = splitObject(b);
    if (fa.size !== fb.size) return 'different';
    let verdict = 'same';
    for (const [key, left] of fa) {
      if (!fb.has(key)) return 'different';
      const r = compareSkeleton(left, fb.get(key));
      if (r === 'different') return 'different';
      if (r === 'unknown') verdict = 'unknown';
    }
    return verdict;
  }

  return 'different';
}

function classify(laravel, aspnet) {
  if (laravel.status === 0 || aspnet.status === 0) return 'UNREACHABLE';
  if (laravel.status !== aspnet.status) return 'STATUS_DIFFERS';
  if (!laravel.parsed || !aspnet.parsed) return 'NOT_JSON';

  const verdict = compareSkeleton(skeleton(laravel.body), skeleton(aspnet.body));
  if (verdict === 'same') return 'MATCH';

  // 🔴 Deliberately NOT counted as a match. The envelope agrees but at least one
  // list was empty, so the row contract inside it is UNTESTED. Calling it
  // identical would overstate parity in exactly the place the thin demo seed
  // hides problems; calling it a difference would invent defects that are not
  // there. It gets its own verdict so the number stays honest both ways.
  if (verdict === 'unknown') return 'MATCH_BUT_LIST_EMPTY';

  return 'SHAPE_DIFFERS';
}

/**
 * 🔴 The two lists are a SAMPLE, capped for readability — the counts are not.
 *
 * This cap was silently misleading before 2026-08-19: it emitted at most eight
 * field names and nothing said so, so a listing-create response where Laravel
 * returns 76 fields and this backend returns 11 was reported as "8 missing".
 * Read as a total that is wrong by a factor of eight, and reviewing the sample
 * looks like reviewing the difference.
 *
 * `missing_count` / `extra_count` are the real totals. Cite those; treat
 * `missing_in_aspnet` / `extra_in_aspnet` as "the first few, to orient you".
 */
const DIFF_SAMPLE_LIMIT = 8;

function describeShapeDiff(laravel, aspnet) {
  const l = fieldPaths(laravel.body);
  const a = fieldPaths(aspnet.body);
  const missing = [...l].filter((f) => !a.has(f));
  const extra = [...a].filter((f) => !l.has(f));
  // 🔴 FULL lists — the cap belongs to the DISPLAY, not the data. Until 2026-08-19
  // this sliced here, so the archived JSON held only 322 of 868 differing field paths
  // and any analysis built on the file silently covered a third of the evidence.
  // Callers that print must slice; DIFF_SAMPLE_LIMIT is exported for them.
  return {
    missing_count: missing.length,
    extra_count: extra.length,
    missing_in_aspnet: missing,
    extra_in_aspnet: extra,
  };
}

export { UNKNOWN_LIST, DIFF_SAMPLE_LIMIT, skeleton, fieldPaths, splitObject, compareSkeleton, classify, describeShapeDiff };
