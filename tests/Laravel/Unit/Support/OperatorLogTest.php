<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\Sentry\OperatorLog;
use Tests\Laravel\TestCase;

/**
 * 🔴 AN OPS ALARM MUST REACH SENTRY EXACTLY ONCE.
 *
 * Every alarm command logs an ERROR line AND explicitly calls
 * `Sentry\captureMessage()` with a deliberate fingerprint. Production's
 * LOG_STACK contains the `sentry` channel, so the log line ALSO became a Sentry
 * event — one carrying no fingerprint, and therefore a second, separate group.
 *
 * Measured: the safeguarding contact-gate alarm fired once on 2026-08-30 and
 * opened NEXUS-PHP-65 (the log leg, tagged logger=production with a
 * `log_context` extra) and NEXUS-PHP-66 (the capture leg) in the same second.
 * Five alarm commands shared the pattern, so each counted double both in the
 * unresolved queue and against the ten-event alarm budget in
 * scripts/postdeploy-watch.mjs.
 */
class OperatorLogTest extends TestCase
{
    public function test_it_strips_the_sentry_channel_from_the_default_stack(): void
    {
        config()->set('logging.default', 'stack');
        config()->set('logging.channels.stack.channels', ['daily', 'stderr', 'sentry']);

        self::assertSame(
            ['daily', 'stderr'],
            OperatorLog::channelsWithoutSentry(),
            'The sentry channel must be removed, or the alarm log line opens a second unfingerprinted Sentry group.'
        );
    }

    public function test_it_preserves_a_stack_that_has_no_sentry_channel(): void
    {
        config()->set('logging.default', 'stack');
        config()->set('logging.channels.stack.channels', ['daily', 'stderr']);

        self::assertSame(['daily', 'stderr'], OperatorLog::channelsWithoutSentry());
    }

    public function test_it_tolerates_whitespace_from_a_comma_separated_log_stack(): void
    {
        // LOG_STACK is exploded on commas in config/logging.php, so a value
        // written as "daily, sentry" yields a channel with a leading space.
        config()->set('logging.default', 'stack');
        config()->set('logging.channels.stack.channels', ['daily', ' sentry', ' stderr']);

        self::assertSame(['daily', 'stderr'], OperatorLog::channelsWithoutSentry());
    }

    public function test_it_never_returns_an_empty_stack(): void
    {
        // A deployment whose LOG_STACK is only `sentry` must still keep a local
        // log line — losing it would make the alarm invisible on the box.
        config()->set('logging.default', 'stack');
        config()->set('logging.channels.stack.channels', ['sentry']);

        self::assertSame(['daily'], OperatorLog::channelsWithoutSentry());
    }

    public function test_it_handles_a_non_stack_default_channel(): void
    {
        // LOG_CHANNEL=single has no nested 'channels' key at all.
        config()->set('logging.default', 'single');

        self::assertSame(['single'], OperatorLog::channelsWithoutSentry());
    }

    public function test_it_builds_a_usable_logger(): void
    {
        config()->set('logging.default', 'stack');
        config()->set('logging.channels.stack.channels', ['daily', 'sentry']);

        $logger = OperatorLog::withoutSentry();

        self::assertInstanceOf(\Psr\Log\LoggerInterface::class, $logger);
    }
}
