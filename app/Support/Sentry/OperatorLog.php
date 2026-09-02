<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Sentry;

use Illuminate\Support\Facades\Log;
use Psr\Log\LoggerInterface;

/**
 * 🔴 A LOGGER FOR OPERATOR ALARMS THAT MUST NOT DOUBLE-REPORT INTO SENTRY.
 *
 * Every scheduled ops alarm in app/Console/Commands is built the same way: an
 * ERROR log line so the condition is visible in `docker logs` and the daily
 * file, plus an EXPLICIT `Sentry\captureMessage()` carrying a deliberate
 * `setFingerprint()` so the same unresolved condition stays one Sentry issue
 * instead of opening a new one every night.
 *
 * Those two are not independent. Production's LOG_STACK includes the `sentry`
 * channel (config/logging.php), so `Log::error()` ALSO becomes a Sentry event —
 * and that one carries NO fingerprint, because a fingerprint lives on the
 * capture scope, not on a log line. The result is TWO Sentry groups for a
 * single occurrence:
 *
 *   - the log leg,     tagged `logger=production` with a `log_context` extra
 *   - the capture leg, carrying the intended fingerprint and named context
 *
 * Measured, not theorised. On 2026-08-30 the safeguarding contact-gate alarm
 * fired once and opened both NEXUS-PHP-65 (143725191, the log leg) and
 * NEXUS-PHP-66 (143725193, the capture leg) in the same second. Five alarm
 * commands shared the pattern, so each was counting double in the unresolved
 * queue AND in `scripts/postdeploy-watch.mjs`, whose alarm budget is 10 events
 * — a single doubled alarm spends two of them.
 *
 * So: log through the real stack MINUS the sentry channel, and let the explicit
 * capture be the only thing that reaches Sentry. Local visibility is unchanged.
 *
 * This deliberately reads the RESOLVED config rather than env(), so it still
 * behaves correctly under `config:cache`, and it mirrors whatever the deployment
 * actually configures instead of hardcoding a channel list that could drift.
 */
final class OperatorLog
{
    /**
     * The stack to fall back to when filtering leaves nothing usable — for
     * instance a deployment whose LOG_STACK is literally just `sentry`. An
     * alarm must never lose its local log line as a side effect of this guard.
     */
    private const FALLBACK_CHANNELS = ['daily'];

    /**
     * A logger equivalent to the configured default stack, with the `sentry`
     * channel removed.
     *
     * Use this for the log leg of any alarm that ALSO calls
     * `Sentry\captureMessage()` itself. Do NOT use it for ordinary application
     * errors: those have no explicit capture, so the sentry log channel is
     * exactly how they are meant to reach Sentry.
     */
    public static function withoutSentry(): LoggerInterface
    {
        return Log::stack(self::channelsWithoutSentry());
    }

    /**
     * The default stack's channels with `sentry` filtered out.
     *
     * @return list<string>
     */
    public static function channelsWithoutSentry(): array
    {
        $default = (string) config('logging.default', 'stack');

        /** @var mixed $configured */
        $configured = config('logging.channels.' . $default . '.channels', []);

        // A non-stack default channel (e.g. LOG_CHANNEL=single) has no
        // 'channels' key at all. Treat the default itself as the one channel.
        if (! is_array($configured) || $configured === []) {
            $configured = [$default];
        }

        $channels = [];
        foreach ($configured as $channel) {
            if (! is_string($channel)) {
                continue;
            }
            $channel = trim($channel);
            if ($channel === '' || $channel === 'sentry') {
                continue;
            }
            $channels[] = $channel;
        }

        $channels = array_values(array_unique($channels));

        return $channels === [] ? self::FALLBACK_CHANNELS : $channels;
    }
}
