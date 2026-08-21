// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Build the CONSUMED-FIELD MANIFEST: every response field name that any client
 * plausibly reads, with the file:line evidence that says so.
 *
 * 🔴 Why this exists. `compare-live-responses.mjs` diffs WHOLE response bodies.
 * Laravel's controllers hand back raw Eloquent models, so one listing carries
 * ~76 fields and an event ~80 — internal database columns no screen has ever
 * read, and at least one (`category.reset_token`) that should never have been
 * serialised at all. Under a whole-body diff, reproducing those counts as
 * required work and not reproducing them counts as a contract gap. That is how
 * "80 of 195 read responses differ" came to be published as an UPPER BOUND
 * rather than a defect count.
 *
 * ADR-0004 fixes the rule: a field is in scope only if a client reads it, acts
 * on it, or its difference changes an outcome. A field with no reader is OUT of
 * scope — Laravel serialising it is a Laravel defect, not ASP.NET's work. This
 * script is the instrument that decides which side of that line a field is on.
 *
 * 🔴 THE BIAS IS DELIBERATE AND IT IS TOWARDS OVER-INCLUSION. A false "in
 * scope" costs a little wasted investigation. A false "out of scope" HIDES A
 * REAL DEFECT — that is exactly the `starts_at` / `start_date` class of bug that
 * rendered an error state behind a wall of HTTP 200s. So every rule below errs
 * towards claiming a reader exists. Where the scan genuinely cannot decide, the
 * consumer must report UNKNOWN and treat it as in scope; it must never round
 * "cannot tell" down to "nothing reads it".
 *
 * 🔴 THIS IS STATIC EVIDENCE OF INTEREST, NOT PROOF OF USE. A name that appears
 * in the client source may occur in a comment, a dead branch, a type describing
 * a DIFFERENT payload, or a request body rather than a response. The strong
 * claim runs the other way: a name that appears NOWHERE in any of the four
 * clients and in no published contract is very unlikely to be read by them. The
 * known error modes are listed in the generated README and must stay there.
 *
 * Readers scanned (ADR-0004 clause 1 names all four, plus clause 4):
 *   react     react-frontend/src        TS/TSX  (includes the React admin)
 *   web-uk    web-uk/src                JS + Nunjucks templates
 *   mobile    mobile/{lib,app,...}      TS/TSX  (Expo / React Native client)
 *   openapi   openapi.json + resources  published contract property names
 *
 * Usage:
 *   node aspnet-backend/scripts/build-consumed-field-manifest.mjs
 *   node aspnet-backend/scripts/build-consumed-field-manifest.mjs --out <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT_DIR = path.resolve(
  flag('out', path.join(REPO_ROOT, 'aspnet-backend', 'docs', 'generated', 'consumed-fields')));

/** How many evidence sites to keep per name PER CLIENT. Counts are complete. */
const SITES_PER_CLIENT = 2;

/**
 * Above this many distinct files, a name's file list is dropped and the name is
 * flagged `ubiquitous` instead.
 *
 * 🔴 This is a size control with a safe failure direction. A name appearing in
 * hundreds of files (`id`, `name`, `status`) is generic, will co-locate with
 * almost any parent, and its file list is what makes this artifact large. Marking
 * it ubiquitous means a consumer treats it as co-located WITHOUT the list — which
 * over-includes, in the direction the bias already runs. Dropping the list in the
 * other direction, so the name looked unread, would hide defects.
 */
const UBIQUITOUS_FILE_COUNT = 200;

/**
 * 🔴 Minimum name length is 2, not 3.
 *
 * `rank-read-differences.mjs` used `{2,}` after the first character, i.e. three
 * characters minimum, which silently excluded `id` — the single most-read field
 * in the entire API and the one every subsequent request is keyed on. Under the
 * over-inclusion bias a short generic name wrongly admitted costs nothing;
 * `id` wrongly excluded would have marked a load-bearing field out of scope.
 */
const NAME_RE_SOURCE = '[A-Za-z_][A-Za-z0-9_]+';

const CLIENTS = [
  {
    id: 'react',
    kind: 'source',
    roots: ['react-frontend/src'],
    exts: ['.ts', '.tsx'],
    note: 'Canonical React frontend and the React admin panel (src/admin).',
  },
  {
    id: 'web-uk',
    kind: 'source',
    roots: ['web-uk/src'],
    exts: ['.js', '.njk'],
    note: 'Production accessible frontend. Route .js files read the API fields; '
      + '.njk templates read the locals those routes derive.',
  },
  {
    id: 'mobile',
    kind: 'source',
    roots: ['mobile/lib', 'mobile/app', 'mobile/components', 'mobile/types', 'mobile/config'],
    exts: ['.ts', '.tsx'],
    note: 'Expo / React Native client. Its lib/api/*.ts modules declare Zod '
      + 'response schemas, which are the most explicit statement of consumption '
      + 'anywhere in the four clients.',
  },
  {
    id: 'openapi',
    kind: 'openapi',
    files: ['openapi.json', 'resources/openapi.json'],
    note: 'ADR-0004 clause 4: a published contract naming a field puts it in '
      + 'scope even with no code reader, because an external consumer may rely on it.',
  },
];

const SKIP_DIR = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.git',
  '.heroui-docs', '__snapshots__',
]);

const TEST_FILE_RE = /(\.test\.|\.spec\.|[\\/]__tests__[\\/]|[\\/]test[\\/]|[\\/]e2e[\\/])/;

/**
 * Files excluded with a stated reason. Kept SHORT and individually justified,
 * because every exclusion is a chance to hide a real reader.
 *
 * 🔴 `resources.d.ts` alone contributed 8,479 of 47,355 names on the first run —
 * 18% of the whole manifest — and NONE of them is an API field. It is
 * i18next-cli's generated translation-key interface (57,974 lines of
 * `"sort_order": "Sort order"`), so its keys are UI copy identifiers that happen
 * to be spelled like database columns. Leaving it in put `sort_order`,
 * `created_by` and hundreds like them "in scope" on the strength of a label,
 * which is precisely the field noise consumed-field mode exists to remove.
 */
const EXCLUDE_FILES = new Map([
  ['react-frontend/src/resources.d.ts',
    'generated i18next translation-key interface — its keys are UI copy, not API fields'],
]);

/**
 * Nunjucks / template keywords and helper names that are never response fields.
 * Kept small on purpose: a wrongly-admitted keyword is harmless noise, a
 * wrongly-excluded field is a hidden defect.
 */
const NJK_STOPWORDS = new Set([
  'if', 'else', 'elif', 'endif', 'for', 'endfor', 'in', 'set', 'block',
  'endblock', 'extends', 'include', 'import', 'from', 'macro', 'endmacro',
  'call', 'endcall', 'filter', 'endfilter', 'raw', 'endraw', 'and', 'or',
  'not', 'true', 'false', 'none', 'null', 'is', 'as', 'with', 'without',
  'context', 'only', 'asyncEach', 'safe', 'escape', 'length', 'join', 'default',
  'trim', 'upper', 'lower', 'replace', 'string', 'int', 'float', 'list',
  'dump', 'loop', 'super', 'self',
]);

/* ── name collection ────────────────────────────────────────────────────── */

/**
 * name -> {
 *   occurrences, clients: Map<clientId, count>, rules: Set, sites: Map<clientId, string[]>,
 *   nonTestEvidence: boolean
 * }
 */
const names = new Map();

/**
 * Every scanned file, in scan order. A name's `files` are indices into this
 * table, which is what makes the CO-LOCATION test affordable.
 *
 * 🔴 Why co-location exists. Matching a field on its LEAF NAME alone has almost
 * no discriminating power on a corpus generated from a client's own call list:
 * measured on the archived 195-path run, 669 of 733 differing field paths (91%)
 * had a leaf name appearing somewhere in some client. Most of those matches were
 * real, but some were plainly spurious — `data.showcased_badges[].msg` matched
 * `.msg` in the messages conversation page, and `…[].threshold` matched the
 * marketplace listing editor. Neither page has ever seen a badge.
 *
 * So the manifest also records WHICH FILE each name was seen in. A consumer can
 * then ask the sharper question: is this leaf read in the same file as the
 * PARENT object it hangs off? A yes is strong evidence. A no is not evidence of
 * absence — it is reported as UNKNOWN and still treated as in scope.
 */
const fileTable = [];
const fileId = new Map();
function fileIdFor(relFile) {
  let id = fileId.get(relFile);
  if (id === undefined) { id = fileTable.push(relFile) - 1; fileId.set(relFile, id); }
  return id;
}

function record(name, clientId, rule, site, isTest) {
  if (!name) return;
  let entry = names.get(name);
  if (!entry) {
    entry = {
      occurrences: 0,
      clients: new Map(),
      rules: new Set(),
      sites: new Map(),
      files: new Set(),
      nonTestEvidence: false,
    };
    names.set(name, entry);
  }
  entry.occurrences += 1;
  entry.clients.set(clientId, (entry.clients.get(clientId) ?? 0) + 1);
  entry.rules.add(rule);
  if (!isTest) entry.nonTestEvidence = true;
  if (site) {
    entry.files.add(fileIdFor(site.replace(/:\d+$/, '')));
    let list = entry.sites.get(clientId);
    if (!list) { list = []; entry.sites.set(clientId, list); }
    // Prefer non-test evidence: a reader in production code is better proof.
    if (list.length < SITES_PER_CLIENT && !list.includes(site)) list.push(site);
  }
}

/** Line number of an absolute string offset, 1-based. Built once per file. */
function lineIndexer(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/* ── extraction rules ───────────────────────────────────────────────────── */

const RULES = {
  dot: {
    // obj.field — the commonest way any client dereferences a response.
    re: new RegExp(`\\.(${NAME_RE_SOURCE})`, 'g'),
    why: 'dot property access',
  },
  bracket: {
    // obj['field'] / obj["field"] / obj[`field`]
    re: new RegExp(`\\[\\s*['"\`](${NAME_RE_SOURCE})['"\`]\\s*\\]`, 'g'),
    why: 'bracket access with a literal key',
  },
  key: {
    // Object-literal keys, TS interface members, and Zod `field: z.string()`.
    // 🔴 A DECLARED RESPONSE TYPE IS A STATEMENT OF WHAT IS CONSUMED, which is
    // why this rule is not restricted to line starts the way the older ranking
    // script was: a Zod schema written on one line still declares its fields.
    re: new RegExp(`(?:^|[{,(\\[\\s])(${NAME_RE_SOURCE})\\s*\\??\\s*:`, 'gm'),
    why: 'object-literal key, interface member, or Zod schema field',
  },
  destructure: {
    // const { a, b: renamed } = response.data
    re: /\{([^{}]{0,400})\}\s*=[^=>]/g,
    why: 'destructuring target',
    expand: (match) => match[1]
      .split(',')
      .map((part) => new RegExp(`^\\s*(?:\\.\\.\\.)?(${NAME_RE_SOURCE})`).exec(part)?.[1])
      .filter(Boolean),
  },
  literal: {
    // 'created_at' passed as a sort key, a column name, a pick() list…
    // Restricted to snake_case with no dots so translation keys do not flood in.
    re: /['"`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"`]/g,
    why: 'snake_case string literal used as a field name',
  },
};

const TS_RULES = ['dot', 'bracket', 'key', 'destructure', 'literal'];

function scanSourceText(text, clientId, relFile, isTest, ruleNames) {
  const lineOf = lineIndexer(text);
  for (const ruleName of ruleNames) {
    const rule = RULES[ruleName];
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const site = `${relFile}:${lineOf(m.index)}`;
      if (rule.expand) {
        for (const name of rule.expand(m)) record(name, clientId, ruleName, site, isTest);
      } else {
        record(m[1], clientId, ruleName, site, isTest);
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

/**
 * Nunjucks templates. Dot access and bracket access behave as in JS; on top of
 * that, a bare identifier inside `{{ … }}` or `{% … %}` is a template variable
 * read, and web-uk's route files pass API-derived objects straight through.
 *
 * 🔴 This rule is noisy by construction — it also picks up macro names, filters
 * and locals the routes invented. That is the over-inclusion bias working as
 * intended: the alternative is guessing which template variable came from an
 * API field, and guessing wrong marks a real field out of scope.
 */
function scanTemplateText(text, clientId, relFile, isTest) {
  scanSourceText(text, clientId, relFile, isTest, ['dot', 'bracket']);
  const lineOf = lineIndexer(text);
  const expr = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g;
  const ident = new RegExp(`\\b(${NAME_RE_SOURCE})\\b`, 'g');
  let m;
  while ((m = expr.exec(text)) !== null) {
    // Strip quoted strings so translation keys and CSS classes do not leak in.
    const inner = (m[1] ?? m[2] ?? '').replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1/g, ' ');
    const line = lineOf(m.index);
    let n;
    while ((n = ident.exec(inner)) !== null) {
      if (NJK_STOPWORDS.has(n[1])) continue;
      record(n[1], clientId, 'template-variable', `${relFile}:${line}`, isTest);
    }
  }
}

/* ── walkers ────────────────────────────────────────────────────────────── */

function walk(dir, exts, onFile) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) stack.push(full);
        continue;
      }
      if (!exts.includes(path.extname(entry.name))) continue;
      onFile(full);
    }
  }
}

/** Collect every `properties` key and `required` entry in an OpenAPI document. */
function scanOpenApi(spec, clientId, relFile, trail = []) {
  if (spec === null || typeof spec !== 'object') return;
  if (Array.isArray(spec)) {
    for (const item of spec) scanOpenApi(item, clientId, relFile, trail);
    return;
  }
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const prop of Object.keys(value)) {
        record(prop, clientId, 'openapi-property', relFile, false);
      }
    }
    if (key === 'required' && Array.isArray(value)) {
      for (const prop of value) {
        if (typeof prop === 'string') record(prop, clientId, 'openapi-required', relFile, false);
      }
    }
    scanOpenApi(value, clientId, relFile, trail.concat(key));
  }
}

/* ── run ────────────────────────────────────────────────────────────────── */

const clientReport = [];

for (const client of CLIENTS) {
  const before = names.size;
  let files = 0;
  const missingRoots = [];
  const excluded = [];

  if (client.kind === 'openapi') {
    for (const rel of client.files) {
      const full = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(full)) { missingRoots.push(rel); continue; }
      files += 1;
      try {
        scanOpenApi(JSON.parse(fs.readFileSync(full, 'utf8')), client.id, rel);
      } catch (error) {
        console.error(`  ! could not parse ${rel}: ${error.message}`);
      }
    }
  } else {
    for (const rel of client.roots) {
      const full = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(full)) { missingRoots.push(rel); continue; }
      walk(full, client.exts, (file) => {
        const relFile = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (EXCLUDE_FILES.has(relFile)) { excluded.push(relFile); return; }
        files += 1;
        const isTest = TEST_FILE_RE.test(relFile);
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
        if (path.extname(file) === '.njk') scanTemplateText(text, client.id, relFile, isTest);
        else scanSourceText(text, client.id, relFile, isTest, TS_RULES);
      });
    }
  }

  const namesForClient = [...names.values()].filter((e) => e.clients.has(client.id)).length;
  clientReport.push({
    id: client.id,
    kind: client.kind,
    roots: client.roots ?? client.files,
    extensions: client.exts ?? null,
    note: client.note,
    files_scanned: files,
    missing_roots: missingRoots,
    files_excluded: excluded.map((f) => ({ file: f, reason: EXCLUDE_FILES.get(f) })),
    names_seen: namesForClient,
    names_first_contributed: names.size - before,
  });
  console.log(
    `${client.id.padEnd(8)} ${String(files).padStart(5)} files  `
    + `${String(namesForClient).padStart(6)} names  (+${names.size - before} new)`
    + (missingRoots.length ? `  MISSING: ${missingRoots.join(', ')}` : ''));
}

/* ── provenance ─────────────────────────────────────────────────────────── */

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch { return null; }
};

const sha = git('rev-parse', 'HEAD');
const dirty = (git('status', '--porcelain') ?? '')
  .split('\n').map((l) => l.trim()).filter(Boolean);

/* ── emit ───────────────────────────────────────────────────────────────── */

const sorted = [...names.keys()].sort();
const testOnly = [];
const outNames = {};
for (const name of sorted) {
  const entry = names.get(name);
  if (!entry.nonTestEvidence) testOnly.push(name);
  outNames[name] = {
    occurrences: entry.occurrences,
    clients: Object.fromEntries([...entry.clients.entries()].sort()),
    rules: [...entry.rules].sort(),
    test_evidence_only: !entry.nonTestEvidence,
    sites: Object.fromEntries([...entry.sites.entries()].sort()),
    ...(entry.files.size > UBIQUITOUS_FILE_COUNT
      ? { ubiquitous: true, file_count: entry.files.size }
      : { files: [...entry.files].sort((a, b) => a - b) }),
  };
}

const namesByClient = {};
for (const client of CLIENTS) {
  namesByClient[client.id] = [...names.values()].filter((e) => e.clients.has(client.id)).length;
}

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  generator: 'aspnet-backend/scripts/build-consumed-field-manifest.mjs',
  authority: 'aspnet-backend/docs/decisions/ADR-0004-journey-equivalence-is-the-target.md',
  repo_sha: sha,
  repo_dirty_paths: dirty.length,
  repo_dirty: dirty.slice(0, 40),
  bias: 'OVER-INCLUSIVE BY DESIGN. A name is admitted on weak evidence because a '
    + 'false "in scope" costs a little wasted investigation while a false "out of '
    + 'scope" hides a real defect. Consumers must treat a name absent from this '
    + 'manifest as "no known reader", never as "proven unread", and must report '
    + 'unclassifiable field paths as UNKNOWN and treat them as in scope.',
  what_this_is_not: [
    'Not proof of use: a name may occur in a comment, a dead branch, a request '
      + 'body, or a type describing a different payload.',
    'Leaf names only: `data[].category.reset_token` is matched on `reset_token`, '
      + 'so a name read on one object counts as read on every object. This '
      + 'over-includes, deliberately.',
    'Dynamic reads are invisible: `row[key]` where key is a variable cannot be '
      + 'attributed to a field name.',
    'Server-side renames are invisible in both directions: web-uk routes map '
      + '`object.earned_count` to a camelCase local, so the API name is caught in '
      + 'the route .js but a template-only field would not be.',
  ],
  clients: clientReport,
  rules: Object.fromEntries(
    Object.entries(RULES).map(([id, r]) => [id, r.why])
      .concat([['template-variable', 'bare identifier inside a Nunjucks {{ }} or {% %} expression']])),
  files: fileTable,
  counts: {
    unique_names: sorted.length,
    scanned_files_indexed: fileTable.length,
    names_by_client: namesByClient,
    names_with_test_evidence_only: testOnly.length,
    total_occurrences: [...names.values()].reduce((s, e) => s + e.occurrences, 0),
  },
  names: outNames,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = path.join(OUT_DIR, 'consumed-field-manifest.json');
// 🔴 Written COMPACT on purpose. Pretty-printed this file is 17.3 MB: the
// (name, file) pairs that make the co-location test possible dominate it, and
// nobody reads 40,000 entries by eye. The human-readable face of this artifact
// is the README.md beside it.
fs.writeFileSync(jsonPath, `${JSON.stringify(manifest)}\n`);

const readme = [
  '# Consumed-Field Manifest (generated)',
  '',
  `Generated: ${manifest.generated_at}`,
  '',
  `- Repository SHA: \`${sha ?? 'unknown'}\``,
  `- Working tree at generation: ${dirty.length === 0 ? 'clean' : `${dirty.length} modified path(s)`}`,
  `- Generator: \`${manifest.generator}\``,
  `- Scope authority: [ADR-0004](../../decisions/ADR-0004-journey-equivalence-is-the-target.md)`,
  '',
  'This is the reader index behind the response harness\'s **consumed-field mode**.',
  'ADR-0004 puts a response field in scope only if a client reads it, acts on it,',
  'or its difference changes an outcome. This file records, for every field name',
  'any client plausibly reads, which clients read it and where.',
  '',
  '## Counts',
  '',
  '| Client | Source | Files scanned | Field names seen |',
  '| --- | --- | ---: | ---: |',
  ...clientReport.map((c) => `| \`${c.id}\` | ${(c.roots ?? []).map((r) => `\`${r}\``).join(', ')} | ${c.files_scanned} | ${c.names_seen} |`),
  '',
  `- Unique field names across all readers: **${sorted.length}**`,
  `- Names evidenced ONLY by test files: ${testOnly.length}`,
  `- Total occurrences indexed: ${manifest.counts.total_occurrences}`,
  '',
  ...(clientReport.some((c) => c.files_excluded?.length) ? [
    '## Files deliberately excluded',
    '',
    'Every exclusion is a chance to hide a real reader, so each is named with its',
    'reason rather than filtered silently.',
    '',
    ...clientReport.flatMap((c) => (c.files_excluded ?? []).map(
      (f) => `- \`${f.file}\` — ${f.reason}`)),
    '',
  ] : []),
  '## How a field is judged',
  '',
  'Three buckets, and the third is not optional:',
  '',
  '| Bucket | Test | What it means |',
  '| --- | --- | --- |',
  '| IN SCOPE | the leaf name is in this manifest, and either has no informative parent or was seen in the same file as its parent object | a client reads it — this is the work queue |',
  '| UNKNOWN | the name is read somewhere but never beside this parent; or the key is a dynamic map key; or the path was cut by the depth cap; or its ancestor list was empty on one side | the scan could not decide — treated **as in scope**, and labelled |',
  '| OUT OF SCOPE | the name appears in no client and in no published contract | record the count and move past; Laravel serialising it is a **Laravel** defect |',
  '',
  '🔴 **Why co-location.** Matching a field on its leaf name alone has almost no',
  'discriminating power on a corpus generated from a client\'s own call list:',
  'measured on the archived 195-path run, 669 of 733 differing field paths (91%)',
  'had a leaf name appearing somewhere. Most matches were real, but some were',
  'plainly spurious — `data.showcased_badges[].msg` matched `.msg` in the messages',
  'conversation page, and `…[].threshold` matched the marketplace listing editor.',
  'Neither page has ever seen a badge. So the manifest also records which file each',
  'name was seen in, and the consumer asks the sharper question: is this leaf read',
  'in the same file as the parent object it hangs off? A yes is strong evidence. A',
  'no is **not** evidence of absence — it is reported as UNKNOWN and still treated',
  'as in scope.',
  '',
  '## The bias, stated plainly',
  '',
  'This scan is **over-inclusive on purpose**. A field wrongly called in scope',
  'costs a little wasted investigation. A field wrongly called out of scope hides',
  'a real defect — which is the `starts_at` / `start_date` class of bug that',
  'rendered an error page behind a wall of HTTP 200s. So every rule errs towards',
  'claiming a reader exists, and any field path the scan cannot classify is',
  'reported as UNKNOWN and treated as in scope.',
  '',
  '## Known false positives (a name is listed but nothing really reads it)',
  '',
  '- **Generic names.** `name`, `status`, `title`, `id` appear in every codebase',
  '  for reasons unrelated to any API response.',
  '- **Leaf-name matching.** A name read on one object counts as read on every',
  '  object, because only the last path segment is matched.',
  '- **Request bodies and local models.** A name written into a POST body, or',
  '  belonging to a purely client-side type, is indistinguishable from a response',
  '  read.',
  '- **Nunjucks template variables.** Macro names, filters and route-invented',
  '  locals are admitted alongside genuine field reads.',
  '- **Tests.** Test files are scanned; see the test-only count above for how many',
  '  names rest on that evidence alone.',
  '',
  '## Known false negatives (something reads a field but it is not listed)',
  '',
  '- **Dynamic property access.** `row[key]` with a variable key is invisible.',
  '- **Spread-through code.** A response object passed whole into a component or',
  '  a template with `{{ obj | dump }}` reads fields no rule can see.',
  '- **Names shorter than two characters.**',
  '- **Non-identifier keys.** Hyphenated or numeric map keys are not indexable as',
  '  property names; the consumer reports these as UNKNOWN rather than guessing.',
  '- **Unscanned surface.** Federation partner contracts and the sales site are',
  '  not scanned. `openapi.json` covers the published contract only as far as its',
  '  own schemas go.',
  '- **Translation catalogues are deliberately not scanned** (`.json` is not in any',
  '  client\'s extension list). `web-uk/src/lib/localization/generated/*.json` and',
  '  the mobile `locales/` files hold UI copy keyed by names like',
  '  `volunteer_hours` — the same false-positive class that made',
  '  `react-frontend/src/resources.d.ts` an explicit exclusion. If a field is only',
  '  ever named in a translation key, this manifest will not see it, and that is',
  '  the intended behaviour.',
  '',
  '## Regenerate',
  '',
  '```bash',
  'node aspnet-backend/scripts/build-consumed-field-manifest.mjs',
  '```',
  '',
  'The machine-readable manifest is `consumed-field-manifest.json`. It is consumed',
  'by `aspnet-backend/scripts/lib/consumed-fields.mjs` and, through it, by',
  '`compare-live-responses.mjs --consumed-fields`.',
  '',
].join('\n');

fs.writeFileSync(path.join(OUT_DIR, 'README.md'), `${readme}\n`);

console.log('');
console.log(`Unique field names : ${sorted.length}`);
console.log(`Test-only evidence : ${testOnly.length}`);
console.log(`Wrote ${path.relative(REPO_ROOT, jsonPath)}`);
console.log(`Wrote ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'README.md'))}`);
