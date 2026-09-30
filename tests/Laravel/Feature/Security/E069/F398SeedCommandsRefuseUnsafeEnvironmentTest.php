<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Console\Commands\SeedAgorisDemoData;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * F-398 — the demo seeders must not be runnable outside a disposable
 * environment, and must not carry a credential in the source.
 *
 * Background. `tenant:seed-agoris-demo` took a tenant slug as an argument, had
 * no environment guard of any kind, and hashed a password that was a `const`
 * literal in a file tracked in the PUBLIC repository. It had been run against
 * the live `agoris` community: 22 production member accounts accepted a
 * password anyone could read on GitHub, in a community with three real
 * administrators and 870 time-credit hours across the exposed accounts.
 *
 * The two properties these tests pin are the two that were missing.
 */
final class F398SeedCommandsRefuseUnsafeEnvironmentTest extends TestCase
{
    use DatabaseTransactions;

    /** Every console command that seeds shared-credential demo accounts. */
    private const SEED_COMMANDS = [
        'tenant:seed-agoris-demo',
        'tenant:seed-agoris-realistic',
        'tenant:seed-agoris-polish',
    ];

    private const SEED_SOURCES = [
        'app/Console/Commands/SeedAgorisDemoData.php',
        'app/Console/Commands/SeedAgorisPolish.php',
        'app/Console/Commands/SeedAgorisRealisticContent.php',
    ];

    /**
     * The harm: on production the command used to run. It must now refuse.
     */
    public function test_seed_commands_refuse_to_run_in_production(): void
    {
        config(['app.env' => 'production']);

        foreach (self::SEED_COMMANDS as $command) {
            $exit = $this->artisan($command)->run();
            $this->assertSame(
                1,
                $exit,
                "{$command} must refuse to run in production (F-398)."
            );
        }
    }

    /**
     * 🔴 The property that actually matters. The pre-existing pattern in this
     * repository is a DENY-list (`if environment('production')`), which passes
     * whenever the environment is unset or unrecognised — the F-027 shape.
     * This asserts the guard is an ALLOW-list and fails CLOSED.
     */
    public function test_seed_commands_refuse_an_unrecognised_or_empty_environment(): void
    {
        foreach (['', 'staging', 'prod', 'Production', 'demo', 'unknown-env'] as $environment) {
            config(['app.env' => $environment]);

            foreach (self::SEED_COMMANDS as $command) {
                $exit = $this->artisan($command)->run();
                $this->assertSame(
                    1,
                    $exit,
                    sprintf(
                        '%s must fail CLOSED for environment "%s" — an allow-list, not a deny-list (F-398).',
                        $command,
                        $environment === '' ? '(empty)' : $environment
                    )
                );
            }
        }
    }

    /**
     * The control: the guard is not simply refusing everything. In a safe
     * environment the command gets past the guard and fails later, on its own
     * terms, for a tenant that does not exist.
     */
    public function test_control_the_guard_passes_in_a_safe_environment(): void
    {
        config(['app.env' => 'testing']);

        // Past the guard: it reaches the tenant lookup and refuses there
        // instead — a different refusal, for a different reason.
        $this->artisan('tenant:seed-agoris-demo', ['slug' => 'no-such-tenant-for-f398'])
            ->expectsOutputToContain('No tenant found')
            ->assertExitCode(1)
            ->run();

        // And it is NOT the environment guard talking.
        $this->artisan('tenant:seed-agoris-demo', ['slug' => 'no-such-tenant-for-f398'])
            ->doesntExpectOutputToContain('REFUSED')
            ->run();
    }

    /**
     * No credential literal may return to the seeder sources.
     */
    public function test_no_seed_command_contains_a_password_literal(): void
    {
        foreach (self::SEED_SOURCES as $relative) {
            $path = base_path($relative);
            $this->assertFileExists($path);
            $source = (string) file_get_contents($path);

            $this->assertStringNotContainsString(
                'Cham-Caring-Pilot',
                $source,
                "{$relative} must not carry the leaked demo password (F-398)."
            );

            $this->assertDoesNotMatchRegularExpression(
                '/const\s+DEMO_PASSWORD\s*=\s*[\'"]/',
                $source,
                "{$relative} must not declare a password constant literal (F-398)."
            );

            $this->assertDoesNotMatchRegularExpression(
                '/(Hash::make|bcrypt|password_hash)\(\s*[\'"][^\'"]{6,}[\'"]/',
                $source,
                "{$relative} must not hash a hard-coded string literal (F-398)."
            );
        }
    }

    /**
     * The credential comes from the environment when it is set, so an operator
     * who wants a predictable demo password supplies it themselves.
     */
    public function test_the_seed_password_is_taken_from_the_environment_when_set(): void
    {
        $this->assertTrue(
            method_exists(SeedAgorisDemoData::class, 'resolveSeedPassword'),
            'The shared resolver must exist.'
        );

        $resolved = SeedAgorisDemoData::resolveSeedPassword();

        $this->assertNotSame('', $resolved);
        $this->assertGreaterThanOrEqual(
            16,
            strlen($resolved),
            'A generated seed password must not be trivially short.'
        );
        $this->assertStringNotContainsString(
            'Cham-Caring-Pilot',
            $resolved,
            'The leaked password must never be resolved again.'
        );
    }
}
