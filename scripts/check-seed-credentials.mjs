// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BLOCKING GATE — seed and fixture credentials.
 *
 * 🔴 Why this exists (F-398, 30 September 2026).
 *
 * `app/Console/Commands/SeedAgorisDemoData.php` declared
 *   public const DEMO_PASSWORD = '<a real password>';
 * in a file tracked in this PUBLIC repository, and the command had no
 * environment guard at all — it took a tenant slug as an argument and ran
 * against whatever slug it was given. It had been run against the live
 * `agoris` community. Result: 22 member accounts on PRODUCTION accepted a
 * password anyone could read on GitHub, holding 870 time-credit hours, in a
 * community with three real administrators.
 *
 * The repository's pre-commit credential scan did not catch it: that scan
 * deliberately excludes generic password patterns because they false-positive
 * constantly on Laravel factories and seeders. This gate is the narrow,
 * targeted replacement — it looks only at code that can actually be RUN
 * against a real database, and it asks two questions:
 *
 *   1. Does it hash a string literal?  (a credential in the source)
 *   2. Does it guard the environment?  (can it run where it must not)
 *
 * Test files are deliberately out of scope: they never run against a real
 * database, and their fixture passwords are not a disclosure.
 *
 * 🔴 Second pass (F-430, 30 September 2026). The gate as first written had two
 * holes, both proved with a synthetic seeder that created a `role = 'god'`
 * account from a published literal with no environment check at all:
 *
 *   1. It asked whether the guard was MENTIONED, not whether it was CALLED.
 *      An unused `use App\Support\Console\RefusesUnsafeSeeding;` import was
 *      enough to turn both "no fail-closed guard" rules off. EXIT=0.
 *   2. It looked only at `app/Console/` and `database/seeders/`. The same file
 *      under `database/migrations/` — which `bluegreen-deploy.sh` runs against
 *      PRODUCTION on every deploy — was never read at all. EXIT=0.
 *
 * Both are closed below. `scripts/test/check-seed-credentials.test.mjs` pins
 * the decision in both directions, including the cases where this gate must
 * stay quiet: it is BLOCKING in CI and in preflight, and a gate that fires on
 * honest code gets bypassed, which is worse than the hole.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Directories whose contents are runnable against a REAL database.
 *
 * 🔴 F-430 added the last four.
 *
 * - `database/migrations/` is the serious one: `bluegreen-deploy.sh` runs
 *   `php artisan migrate --force` before every traffic switch, so a migration
 *   that creates an account is the F-398 shape with a shorter fuse than a
 *   seeder had.
 * - `migrations/` is the legacy SQL/PHP set that `make migrate-prod` aims
 *   straight at production.
 * - `routes/console.php` holds Artisan closures. There is no such file today;
 *   it is listed so that one cannot be added unscanned.
 * - `app/Providers/` boots on every production request.
 *
 * Deliberately NOT scanned: `database/factories/` and `tests/`. Factory
 * passwords are fixtures and only reach a database through a seeder or a test
 * — and the seeder IS scanned here — so adding them would fail the build on
 * `UserFactory` for no security gain.
 */
const RUNNABLE_PREFIXES = [
  'app/Console/',
  'app/Providers/',
  'database/seeders/',
  'database/migrations/',
  'migrations/',
  'routes/console.php',
];

/** Hashing a string literal of meaningful length = a credential in the source. */
const LITERAL_HASH = /(?:Hash::make|bcrypt|password_hash)\(\s*['"][^'"]{6,}['"]/;

/** A constant or property assigned a password-shaped literal. */
const LITERAL_CONST =
  /(?:const|public|private|protected|static)\s+\$?[A-Z_a-z]*(?:PASSWORD|Password|password)[A-Z_a-z]*\s*=\s*['"][^'"]{6,}['"]/;

/** A credential default supplied inline, e.g. env('X_PASSWORD', 'literal'). */
const LITERAL_ENV_DEFAULT =
  /env\(\s*['"][A-Z0-9_]*PASSWORD[A-Z0-9_]*['"]\s*,\s*['"][^'"]{6,}['"]\s*\)/;

/** Evidence the file establishes a credential at all. */
const SETS_CREDENTIAL = /(?:Hash::make|bcrypt|password_hash)\s*\(/;

/**
 * 🔴 A FAIL-CLOSED guard: an allow-list of safe environments, so anything the
 * author did not explicitly name — a typo, `staging`, an unset APP_ENV — is
 * refused.
 *
 * A deny-list (`if (app()->environment('production')) { return; }`) is NOT
 * accepted here, and that is the whole point of this gate. It is the shape
 * that produced F-027, and it is what let F-398's seeder run anywhere that was
 * not spelled exactly `production`.
 *
 * 🔴 And it must be CALLED. This was `/RefusesUnsafeSeeding|refuseUnless…/` —
 * a textual presence test over the whole file — so an unused
 * `use App\Support\Console\RefusesUnsafeSeeding;` import satisfied it, and so
 * did the `use RefusesUnsafeSeeding;` that merely mixes the trait into a
 * class. Neither line runs anything (F-430).
 */
const GUARD_INVOCATION =
  /(?:\$this|self|static)\s*(?:->|::)\s*refuseUnlessSafeSeedingEnvironment\s*\(/;

/**
 * The same call written as a statement on its own line, which throws the
 * refusal exit code away and carries on seeding. All three real callers
 * consume it: `if (($refusal = $this->refuse…()) !== null) { return $refusal; }`.
 */
const GUARD_RESULT_DISCARDED =
  /^\s*(?:\$this|self|static)\s*(?:->|::)\s*refuseUnlessSafeSeedingEnvironment\s*\(\s*\)\s*;/;

/**
 * The inline allow-list, which is the shape the seeders use because they are
 * not console commands and cannot reach the trait:
 * `in_array($environment, self::SAFE_*_ENVIRONMENTS, true)`.
 */
const INLINE_ALLOW_LIST_GUARD =
  /in_array\(\s*\$?\w*[Ee]nvironment\w*\s*,\s*(?:self::)?SAFE_\w+/;

/** Is the file in a directory that can be run against a real database? */
export function isRunnablePath(file) {
  return file.endsWith('.php') && RUNNABLE_PREFIXES.some((p) => file.startsWith(p));
}

/**
 * Strip comments so an explanatory block quoting the old pattern cannot trip
 * the gate. (This file's own prose is not scanned — it is not PHP.)
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

/**
 * Does this code actually invoke a fail-closed environment guard?
 *
 * Line-by-line on purpose: a call split across two lines is not recognised and
 * is therefore reported as unguarded. That is the safe direction, and no
 * caller in this repository writes it that way.
 */
export function hasFailClosedGuard(code) {
  if (INLINE_ALLOW_LIST_GUARD.test(code)) {
    return true;
  }

  return code
    .split('\n')
    .some((line) => GUARD_INVOCATION.test(line) && !GUARD_RESULT_DISCARDED.test(line));
}

/**
 * Split stripped PHP into its methods: name, visibility, body.
 *
 * Brace matching ignores braces inside string literals only roughly (no PHP
 * string in a runnable file here contains one); a method it cannot close is
 * returned with the rest of the file as its body, which errs towards
 * reporting rather than absolving.
 */
export function splitMethods(code) {
  const methods = [];
  const signature = /^([^\n]*?)\bfunction\s+(\w+)\s*\(/gm;
  let match;
  while ((match = signature.exec(code)) !== null) {
    const prefix = match[1];
    const name = match[2];
    let i = signature.lastIndex;
    // Skip to the body's opening brace; an abstract or interface method ends in `;`.
    while (i < code.length && code[i] !== '{' && code[i] !== ';') i++;
    if (code[i] !== '{') continue;
    let depth = 0;
    let end = i;
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++;
      else if (code[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    methods.push({
      name,
      isPublic: !/\b(?:private|protected)\b/.test(prefix),
      body: code.slice(i, end + 1),
    });
    signature.lastIndex = end + 1;
  }
  return methods;
}

/**
 * F-494: the methods that create a credential without a fail-closed guard on
 * their path.
 *
 * The guard used to be judged once per FILE, so a guard in `run()` absolved a
 * second PUBLIC method in the same class that created a `role='god'` account
 * from a published constant — F-398's own shape, which an operator or another
 * class can call directly. A credential-creating method now counts as guarded
 * only if it calls the guard itself, or it is private/protected and every
 * method in the class that calls it is itself guarded.
 */
export function unguardedCredentialMethods(code) {
  const methods = splitMethods(code);
  const guarded = new Map(methods.map((m) => [m.name, hasFailClosedGuard(m.body)]));
  const callsTo = (caller, callee) =>
    new RegExp(`(?:\\$this\\s*->|self\\s*::|static\\s*::)\\s*${callee}\\s*\\(`).test(caller.body);

  // Fixed point: a non-public method becomes guarded once every caller is.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of methods) {
      if (guarded.get(m.name) || m.isPublic) continue;
      const callers = methods.filter((c) => c.name !== m.name && callsTo(c, m.name));
      if (callers.length > 0 && callers.every((c) => guarded.get(c.name))) {
        guarded.set(m.name, true);
        changed = true;
      }
    }
  }

  return methods
    .filter((m) => SETS_CREDENTIAL.test(m.body) && !guarded.get(m.name))
    .map((m) => m.name);
}

/** Every problem this gate finds in one file. */
export function auditSource(file, source) {
  const problems = [];
  const code = stripComments(source);
  // A file-level guard is still required, and is no longer sufficient on its
  // own: every method that creates a credential must have one on its path.
  const unguarded = unguardedCredentialMethods(code);
  const failsClosed = hasFailClosedGuard(code) && unguarded.length === 0;

  // Always wrong: there is no reason to hash an inline literal.
  if (LITERAL_HASH.test(code)) {
    problems.push({
      file,
      problem: 'hashes a hard-coded string literal',
      fix: 'Take the value from the environment (or generate it). See app/Support/Console/RefusesUnsafeSeeding.php.',
    });
  }

  // A documented default is acceptable ONLY if it cannot reach a real
  // environment. That is the actual security property, so the gate tests it
  // rather than banning defaults outright — README/TUTORIAL first-run
  // credentials are legitimate and should keep working locally.
  if ((LITERAL_CONST.test(code) || LITERAL_ENV_DEFAULT.test(code)) && !failsClosed) {
    problems.push({
      file,
      problem:
        'carries a default credential without a FAIL-CLOSED environment guard',
      fix:
        'Add an allow-list guard (in_array($environment, self::SAFE_*_ENVIRONMENTS, true)) ' +
        'or use App\\Support\\Console\\RefusesUnsafeSeeding and CALL ' +
        'refuseUnlessSafeSeedingEnvironment(). Importing the trait is not a guard. ' +
        'A deny-list on "production" is not enough — ' +
        'it passes for a typo, for "staging", and for an unset APP_ENV.',
    });
  }

  if (SETS_CREDENTIAL.test(code) && !failsClosed) {
    problems.push({
      file,
      problem: unguarded.length > 0 && hasFailClosedGuard(code)
        ? `creates credentials in ${unguarded.map((m) => `${m}()`).join(', ')} with no FAIL-CLOSED environment guard on that path`
        : 'creates credentials but has no FAIL-CLOSED environment guard',
      fix: 'use App\\Support\\Console\\RefusesUnsafeSeeding and CALL refuseUnlessSafeSeedingEnvironment() first — importing it is not a guard.',
    });
  }

  return problems;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function main() {
  const failures = [];

  for (const file of trackedFiles()) {
    if (!isRunnablePath(file)) continue;

    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    failures.push(...auditSource(file, source));
  }

  if (failures.length > 0) {
    console.error('');
    console.error('check:seed-credentials FAILED');
    console.error('');
    console.error(
      'Runnable code (console commands, seeders, migrations, providers) must not carry',
    );
    console.error(
      'a credential in its source, and must refuse to run outside a disposable environment.',
    );
    console.error('This gate exists because security finding F-398 put 22 accounts with a');
    console.error('publicly published password onto the production platform.');
    console.error('');
    for (const f of failures) {
      console.error(`  ${f.file}`);
      console.error(`      problem: ${f.problem}`);
      console.error(`      fix:     ${f.fix}`);
      console.error('');
    }
    process.exit(1);
  }

  console.log('check:seed-credentials OK — no credential literals, and every seeder guards its environment.');
}

// Importable by scripts/test/check-seed-credentials.test.mjs; only the direct
// invocation scans the repository and sets an exit code.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
