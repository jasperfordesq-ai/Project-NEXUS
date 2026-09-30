<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Console;

use Illuminate\Support\Str;

/**
 * Shared safety gate for console commands that create accounts with a
 * known or shared credential (demo, pilot and fixture seeders).
 *
 * 🔴 Why this exists (F-398, 30 September 2026). The Agoris demo seeders
 * carried a password literal in the source of a PUBLIC repository and had no
 * environment guard at all. The command took a tenant slug as an argument and
 * would run against whatever slug it was given. It had been run against the
 * live `agoris` community, leaving 22 member accounts on production that
 * accepted a password anyone could read on GitHub. Those accounts held 870
 * time-credit hours and sat in a community with three real administrators.
 *
 * Two rules follow from that, and both are enforced here:
 *
 * 1. **Fail CLOSED on environment.** The pre-existing pattern in this
 *    repository is `if (app()->environment('production')) { refuse; }` — a
 *    deny-list. A deny-list passes whenever the environment is unset,
 *    misspelled, or simply named something the author did not think of, which
 *    is the same shape as F-027. This trait uses an ALLOW-LIST: unless the
 *    environment is explicitly one of the known-safe ones, the command
 *    refuses. An unset APP_ENV refuses. A typo refuses.
 *
 * 2. **Never put the credential in the source.** {@see resolveSeedPassword()}
 *    reads `NEXUS_DEMO_SEED_PASSWORD` from the environment, and when that is
 *    absent it GENERATES a random one and prints it once. There is no literal
 *    to leak, and nothing to find by reading the repository.
 */
trait RefusesUnsafeSeeding
{
    /**
     * Environments in which creating known-credential accounts is acceptable.
     * Anything not on this list — including an empty or unrecognised value —
     * is refused.
     */
    private const SAFE_SEEDING_ENVIRONMENTS = ['local', 'development', 'testing'];

    /**
     * Cached for the life of the process so that several seeder commands
     * chained in one run (demo → realistic → polish) agree on one password.
     */
    private static ?string $resolvedSeedPassword = null;

    /**
     * Refuse to run anywhere that is not explicitly a safe environment.
     *
     * @return int|null `null` when it is safe to proceed; a command exit code
     *                  when the caller must stop and return it immediately.
     */
    protected function refuseUnlessSafeSeedingEnvironment(): ?int
    {
        $environment = trim((string) app()->environment());

        if (in_array($environment, self::SAFE_SEEDING_ENVIRONMENTS, true)) {
            return null;
        }

        $shown = $environment === '' ? '(empty)' : $environment;

        $this->error('REFUSED: this command creates accounts with a shared, known password.');
        $this->error("Current environment is '{$shown}'.");
        $this->line('It runs only in: ' . implode(', ', self::SAFE_SEEDING_ENVIRONMENTS) . '.');
        $this->newLine();
        $this->line('This guard fails closed on purpose. It was added after demo accounts');
        $this->line('created by this command were found live on production with a password');
        $this->line('published in the public repository (security finding F-398).');
        $this->line('There is no override flag. If you genuinely need demo data somewhere');
        $this->line('else, seed it locally and move it deliberately.');

        return 1; // Command::FAILURE
    }

    /**
     * The password used for seeded demo accounts.
     *
     * Set `NEXUS_DEMO_SEED_PASSWORD` when you want a predictable one that a
     * pilot evaluator can reuse across personas. Leave it unset and a random
     * password is generated for this run and printed once — which is the safe
     * default, because nothing is then recoverable from the source.
     *
     * 🔴 Never replace this with a literal. `npm run check:seed-credentials`
     * fails the build if a literal reappears.
     */
    public static function resolveSeedPassword(): string
    {
        if (self::$resolvedSeedPassword !== null) {
            return self::$resolvedSeedPassword;
        }

        $fromEnvironment = trim(self::readEnvironmentValue('NEXUS_DEMO_SEED_PASSWORD'));
        if ($fromEnvironment !== '') {
            return self::$resolvedSeedPassword = $fromEnvironment;
        }

        // Random, and shaped to satisfy any reasonable strength rule.
        return self::$resolvedSeedPassword = 'Seed-' . Str::random(28) . '-7aZ!';
    }

    /**
     * Read one environment value without Laravel's `env()` helper.
     *
     * `env()` returns null once the configuration is cached, and larastan
     * rightly refuses it outside `config/`. These seeders run from the console,
     * where the cache may well be warm, so read the superglobals directly —
     * Laravel's Dotenv populates `$_ENV` and `$_SERVER`, and `getenv()` covers
     * a value exported by the shell or passed with `docker exec -e`.
     */
    private static function readEnvironmentValue(string $key): string
    {
        foreach ([$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)] as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                return $candidate;
            }
        }

        return '';
    }

    /**
     * Print the credential once, at the end of a run, with the warning that
     * belongs beside it. Called by the seeders rather than echoing inline.
     */
    protected function reportSeedPassword(string $adminEmail): void
    {
        $viaEnvironment = trim(self::readEnvironmentValue('NEXUS_DEMO_SEED_PASSWORD')) !== '';

        $this->newLine();
        $this->line('Demo admin: ' . $adminEmail);
        $this->line('Demo password for ALL seeded accounts: ' . self::resolveSeedPassword());
        $this->line($viaEnvironment
            ? '(from NEXUS_DEMO_SEED_PASSWORD)'
            : '(generated for this run — not stored anywhere; set NEXUS_DEMO_SEED_PASSWORD for a stable one)');
        $this->newLine();
        $this->warn('These accounts share one password. They belong in a disposable');
        $this->warn('environment only. Never seed them into a community with real members.');
    }
}
