<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\Sentry\SentryInvocation;
use PHPUnit\Framework\TestCase;

/**
 * 🔴 The dangerous failure mode here is a FALSE POSITIVE, not a false negative.
 *
 * Tagging a real production failure as a hand-run one-liner would hide it from
 * the post-deploy error watch, which is the one check standing between a bad
 * deploy and a silent outage. Queue workers, the scheduler and artisan commands
 * are production. So the "must NOT match" cases below matter more than the
 * "must match" ones, and both are asserted.
 */
final class SentryInvocationTest extends TestCase
{
    /**
     * @return array<string, array{0: array<int, string>, 1: string}>
     */
    public static function evalInvocations(): array
    {
        return [
            'php -r one-liner' => [['Standard input code'], 'cli'],
            'stack-frame naming for inline code' => [['Command line code'], 'cli'],
            'code piped in on stdin' => [['-'], 'cli'],
            'php -r with trailing args' => [['Standard input code', 'extra'], 'cli'],
        ];
    }

    /**
     * @param array<int, string> $argv
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('evalInvocations')]
    public function test_it_recognises_inline_command_line_code(array $argv, string $sapi): void
    {
        $this->assertTrue(SentryInvocation::isEvalInvocation($argv, $sapi));
    }

    /**
     * @return array<string, array{0: array<int, string>, 1: string}>
     */
    public static function realInvocations(): array
    {
        return [
            // 🔴 Each of these is production. Tagging any of them would remove a
            // real failure from the post-deploy watch.
            'artisan command' => [['artisan', 'migrate', '--force'], 'cli'],
            'queue worker' => [['artisan', 'queue:work'], 'cli'],
            'scheduler' => [['artisan', 'schedule:run'], 'cli'],
            'a script by relative path' => [['scripts/sync_search_index.php'], 'cli'],
            'a script by absolute path' => [['/var/www/html/artisan', 'migrate'], 'cli'],
            'phpunit' => [['vendor/bin/phpunit'], 'cli'],
            'an HTTP request under fpm' => [[], 'fpm-fcgi'],
            // An HTTP request is a real request whatever argv happens to hold.
            'http request with a misleading argv' => [['Standard input code'], 'fpm-fcgi'],
            'apache handler' => [['-'], 'apache2handler'],
            'empty argv on cli' => [[], 'cli'],
            'empty string entry' => [[''], 'cli'],
            'a path that merely contains the placeholder' => [['/opt/Standard input code/run.php'], 'cli'],
        ];
    }

    /**
     * @param array<int, string> $argv
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('realInvocations')]
    public function test_it_does_not_match_real_production_invocations(array $argv, string $sapi): void
    {
        $this->assertFalse(SentryInvocation::isEvalInvocation($argv, $sapi));
    }

    public function test_it_tolerates_a_non_string_argv_entry(): void
    {
        $this->assertFalse(SentryInvocation::isEvalInvocation([123], 'cli'));
    }

    public function test_the_tag_constants_match_what_the_deploy_watch_filters_on(): void
    {
        // scripts/postdeploy-watch.mjs filters on the literal `!invocation:cli-eval`.
        // If either side is renamed without the other, hand-run typos silently
        // start counting against the deploy alarm budget again.
        $this->assertSame('invocation', SentryInvocation::TAG_KEY);
        $this->assertSame('cli-eval', SentryInvocation::TAG_CLI_EVAL);

        $watch = file_get_contents(__DIR__ . '/../../../../scripts/postdeploy-watch.mjs');
        $this->assertIsString($watch);
        $this->assertStringContainsString(
            SentryInvocation::TAG_KEY . "'}:" . SentryInvocation::TAG_CLI_EVAL,
            $watch,
            'postdeploy-watch.mjs no longer excludes the tag this class sets'
        );
    }
}
