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
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/** Directories whose contents are runnable against a real database. */
const RUNNABLE_PREFIXES = ['app/Console/', 'database/seeders/'];

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
 */
const FAIL_CLOSED_GUARD =
  /RefusesUnsafeSeeding|refuseUnlessSafeSeedingEnvironment|in_array\(\s*\$?\w*[Ee]nvironment\w*\s*,\s*(?:self::)?SAFE_\w+/;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

const failures = [];

for (const file of trackedFiles()) {
  if (!file.endsWith('.php')) continue;
  if (!RUNNABLE_PREFIXES.some((p) => file.startsWith(p))) continue;

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  // Strip comments so an explanatory block quoting the old pattern cannot
  // trip the gate. (This file's own prose is not scanned — it is not PHP.)
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');

  const failsClosed = FAIL_CLOSED_GUARD.test(code);

  // Always wrong: there is no reason to hash an inline literal.
  if (LITERAL_HASH.test(code)) {
    failures.push({
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
    failures.push({
      file,
      problem:
        'carries a default credential without a FAIL-CLOSED environment guard',
      fix:
        'Add an allow-list guard (in_array($environment, self::SAFE_*_ENVIRONMENTS, true)) ' +
        'or use App\\Support\\Console\\RefusesUnsafeSeeding. A deny-list on "production" is not enough — ' +
        'it passes for a typo, for "staging", and for an unset APP_ENV.',
    });
  }

  if (SETS_CREDENTIAL.test(code) && !failsClosed) {
    failures.push({
      file,
      problem: 'creates credentials but has no FAIL-CLOSED environment guard',
      fix: 'use App\\Support\\Console\\RefusesUnsafeSeeding and call refuseUnlessSafeSeedingEnvironment() first.',
    });
  }
}

if (failures.length > 0) {
  console.error('');
  console.error('check:seed-credentials FAILED');
  console.error('');
  console.error(
    'Runnable code (console commands, database seeders) must not carry a credential',
  );
  console.error(
    'in its source, and must refuse to run outside a disposable environment.',
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
