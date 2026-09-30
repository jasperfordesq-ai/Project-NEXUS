// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// check-seed-credentials.test.mjs — pins what the F-398 gate stops and, just
// as importantly, what it must stay quiet about.
//
// 🔴 Why this file exists (F-430). The gate was created in response to F-398,
// which put 22 production accounts behind a password published in this public
// repository for 153 days. It is the only automated defence against a
// recurrence, and as first written it had two holes, both proved against the
// real script with synthetic fixtures:
//
//   * it asked whether the guard was MENTIONED, not whether it was CALLED, so
//     an unused `use App\Support\Console\RefusesUnsafeSeeding;` import turned
//     both "no fail-closed guard" rules off; and
//   * it never looked at `database/migrations/`, which runs against PRODUCTION
//     on every deploy.
//
// Every "blocked" sample below is that synthetic seeder — it creates a
// `role = 'god'` account from a literal credential with no working environment
// check. Every "allowed" sample is a shape that really exists in this
// repository today and that an over-eager rule would have failed the build on.
// The gate is BLOCKING in CI and in preflight; one that cries wolf gets
// bypassed, which is worse than the hole.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSource,
  hasFailClosedGuard,
  isRunnablePath,
  stripComments,
} from '../check-seed-credentials.mjs';

const CREDENTIAL_BODY = `
    public const DEFAULT_ADMIN_PASSWORD = 'PilotAccess2026!';

    public function run(): void
    {
        $password = env('SEED_ADMIN_PASSWORD', self::DEFAULT_ADMIN_PASSWORD);

        DB::table('users')->insert([
            'email' => 'pilot-admin@example.test',
            'password' => Hash::make($password),
            'role' => 'god',
            'is_god' => 1,
        ]);
    }
`;

const UNGUARDED_SEEDER = `<?php
namespace Database\\Seeders;
use Illuminate\\Database\\Seeder;
class PilotAdminSeeder extends Seeder
{${CREDENTIAL_BODY}}
`;

// F-430 hole 1: the import alone used to satisfy the gate.
const SEEDER_WITH_UNUSED_IMPORT = `<?php
namespace Database\\Seeders;
use App\\Support\\Console\\RefusesUnsafeSeeding;
use Illuminate\\Database\\Seeder;
class PilotAdminSeeder extends Seeder
{${CREDENTIAL_BODY}}
`;

// The trait mixed in but never called is the same non-guard.
const COMMAND_WITH_TRAIT_NEVER_CALLED = `<?php
namespace App\\Console\\Commands;
use App\\Support\\Console\\RefusesUnsafeSeeding;
use Illuminate\\Console\\Command;
class SeedPilotAdmin extends Command
{
    use RefusesUnsafeSeeding;
${CREDENTIAL_BODY}}
`;

// Called, but the refusal exit code is thrown away, so the command carries on.
const COMMAND_WITH_DISCARDED_RESULT = `<?php
namespace App\\Console\\Commands;
use App\\Support\\Console\\RefusesUnsafeSeeding;
use Illuminate\\Console\\Command;
class SeedPilotAdmin extends Command
{
    use RefusesUnsafeSeeding;

    public function handle(): int
    {
        $this->refuseUnlessSafeSeedingEnvironment();
${CREDENTIAL_BODY}
        return self::SUCCESS;
    }
}
`;

// A deny-list is not a guard: it passes for a typo, for "staging" and for an
// unset APP_ENV. This is the shape that produced F-027 and F-398.
const COMMAND_WITH_DENY_LIST = `<?php
namespace App\\Console\\Commands;
use Illuminate\\Console\\Command;
class SeedPilotAdmin extends Command
{
    public function handle(): int
    {
        if (app()->environment('production')) {
            return self::FAILURE;
        }
${CREDENTIAL_BODY}
        return self::SUCCESS;
    }
}
`;

// ── Allowed: the real shapes in this repository ──────────────────────────────

// app/Console/Commands/SeedAgorisDemoData.php:56 and its two siblings.
const COMMAND_WITH_REAL_GUARD = `<?php
namespace App\\Console\\Commands;
use App\\Support\\Console\\RefusesUnsafeSeeding;
use Illuminate\\Console\\Command;
class SeedPilotAdmin extends Command
{
    use RefusesUnsafeSeeding;

    public function handle(): int
    {
        if (($refusal = $this->refuseUnlessSafeSeedingEnvironment()) !== null) {
            return $refusal;
        }
${CREDENTIAL_BODY}
        return self::SUCCESS;
    }
}
`;

// database/seeders/TenantSeeder.php:128 — seeders cannot reach the console
// trait, so they spell the allow-list inline.
const SEEDER_WITH_INLINE_ALLOW_LIST = `<?php
namespace Database\\Seeders;
use Illuminate\\Database\\Seeder;
class PilotAdminSeeder extends Seeder
{
    private const SAFE_SEEDING_ENVIRONMENTS = ['local', 'development', 'testing'];

    public function run(): void
    {
        $environment = trim((string) app()->environment());

        if (! in_array($environment, self::SAFE_SEEDING_ENVIRONMENTS, true)) {
            throw new \\RuntimeException('REFUSED');
        }
${CREDENTIAL_BODY}    }
}
`;

const blocked = [
  ['an unused RefusesUnsafeSeeding import is not a guard (F-430)', 'database/seeders/PilotAdminSeeder.php', SEEDER_WITH_UNUSED_IMPORT],
  ['a trait mixed in but never called is not a guard (F-430)', 'app/Console/Commands/SeedPilotAdmin.php', COMMAND_WITH_TRAIT_NEVER_CALLED],
  ['a guard call whose refusal code is discarded is not a guard (F-430)', 'app/Console/Commands/SeedPilotAdmin.php', COMMAND_WITH_DISCARDED_RESULT],
  ['a deny-list on "production" is not a guard (F-027, F-398)', 'app/Console/Commands/SeedPilotAdmin.php', COMMAND_WITH_DENY_LIST],
  ['no guard at all, in a seeder', 'database/seeders/PilotAdminSeeder.php', UNGUARDED_SEEDER],
  ['no guard at all, in a Laravel migration (F-430)', 'database/migrations/2026_09_30_000000_seed_pilot_admin.php', UNGUARDED_SEEDER],
  ['no guard at all, in a legacy migration (F-430)', 'migrations/2026_09_30_seed_pilot_admin.php', UNGUARDED_SEEDER],
  ['no guard at all, in a service provider (F-430)', 'app/Providers/PilotServiceProvider.php', UNGUARDED_SEEDER],
];

const allowed = [
  ['the guard is actually called and its refusal returned', 'app/Console/Commands/SeedPilotAdmin.php', COMMAND_WITH_REAL_GUARD],
  ['a seeder spelling the allow-list inline', 'database/seeders/PilotAdminSeeder.php', SEEDER_WITH_INLINE_ALLOW_LIST],
];

for (const [label, file, source] of blocked) {
  test(`blocks: ${label}`, () => {
    assert.notDeepEqual(auditSource(file, source), [], `expected ${file} to be refused`);
  });
}

for (const [label, file, source] of allowed) {
  test(`allows: ${label}`, () => {
    assert.deepEqual(auditSource(file, source), [], `expected ${file} to pass`);
  });
}

// ── Which paths are read at all ──────────────────────────────────────────────

const scanned = [
  'app/Console/Commands/SeedAgorisDemoData.php',
  'app/Providers/AppServiceProvider.php',
  'database/seeders/TenantSeeder.php',
  'database/migrations/2026_09_30_000000_seed_pilot_admin.php',
  'migrations/2026_01_25_seed_legal_documents_content.php',
  'routes/console.php',
];

const notScanned = [
  // Fixtures. They only reach a database through a seeder or a test, and the
  // seeder is scanned; failing the build on UserFactory would buy nothing.
  'database/factories/UserFactory.php',
  'tests/Laravel/Feature/Seeders/TenantSeederTest.php',
  // Not PHP.
  'migrations/2026_02_01_add_totp_2fa_system.sql',
  'scripts/check-seed-credentials.mjs',
];

for (const file of scanned) {
  test(`scans ${file}`, () => assert.equal(isRunnablePath(file), true));
}

for (const file of notScanned) {
  test(`does not scan ${file}`, () => assert.equal(isRunnablePath(file), false));
}

// ── The two helpers, pinned directly ─────────────────────────────────────────

test('a guard quoted only in a comment does not count', () => {
  const code = stripComments(`<?php
/**
 * Historically this called $this->refuseUnlessSafeSeedingEnvironment().
 */
// $this->refuseUnlessSafeSeedingEnvironment();
class X {}
`);
  assert.equal(hasFailClosedGuard(code), false);
});

test('a real call counts', () => {
  assert.equal(
    hasFailClosedGuard('if (($r = $this->refuseUnlessSafeSeedingEnvironment()) !== null) { return $r; }'),
    true,
  );
});
