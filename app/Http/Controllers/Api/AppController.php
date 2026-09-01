<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;

/**
 * AppController -- Mobile app version check and logging.
 *
 * Native implementation (no delegation).
 */
class AppController extends BaseApiController
{
    protected bool $isV2Api = true;

    /*
     * 🔴 These describe the CAPACITOR wrapper around the React web app, not the Expo
     * client in mobile/. They are two different artefacts on two different version
     * lines; do not "tidy" them to match.
     *
     * The values moved to config/mobile.php unchanged. They were hardcoded constants
     * here under a comment instructing the reader to keep them in step with
     * `capacitor/android/app/build.gradle` — a path that is NOT in this repository
     * (removed in df8bf84d6 and gitignored), so that instruction could not be
     * followed and the numbers had no reachable second source to agree with.
     * `react-frontend/src/hooks/useAppUpdate.ts` is the real consumer and still is.
     *
     * Being in config also means the minimum can be raised in an emergency without a
     * code deploy, which is the entire point of a force-update lever.
     */
    private function capacitorCurrentVersion(): string
    {
        return (string) config('mobile.capacitor.current_version', '1.1');
    }

    private function capacitorMinimumVersion(): string
    {
        return (string) config('mobile.capacitor.minimum_version', '1.0');
    }

    private function capacitorUpdateUrl(): string
    {
        return (string) config(
            'mobile.capacitor.update_url',
            'https://api.project-nexus.ie/downloads/nexus-latest.apk'
        );
    }

    // What's new in the latest version
    private const RELEASE_NOTES = [
        '1.0' => [
            'Initial release',
            'Persistent login (stay logged in for 1 year)',
            'Offline support',
            'Push notifications',
        ],
        '1.1' => [
            'New React frontend with HeroUI components',
            'Content moderation system (feed, comments, reviews, reports)',
            'Super admin panel with tenant management',
            'Updated to app.project-nexus.ie domain',
            'Bug fixes and performance improvements',
        ],
    ];

    /**
     * POST /api/app/check-version
     *
     * Check app version and return update status.
     * Body: { "version": "1.0.0", "platform": "android" }
     */
    public function checkVersion(): JsonResponse
    {
        $this->rateLimit('app_check_version', 30, 60);

        $clientVersion = $this->input('version', '0.0.0');
        $platform = $this->input('platform', 'android');

        $needsUpdate = version_compare($clientVersion, $this->capacitorCurrentVersion(), '<');
        $forceUpdate = version_compare($clientVersion, $this->capacitorMinimumVersion(), '<');

        // Get release notes for versions newer than client
        $releaseNotes = [];
        foreach (self::RELEASE_NOTES as $version => $notes) {
            if (version_compare($version, $clientVersion, '>')) {
                $releaseNotes[$version] = $notes;
            }
        }

        $response = [
            'success' => true,
            'current_version' => $this->capacitorCurrentVersion(),
            'min_required_version' => $this->capacitorMinimumVersion(),
            'client_version' => $clientVersion,
            'update_available' => $needsUpdate,
            'force_update' => $forceUpdate,
            'update_url' => $this->capacitorUpdateUrl(),
            'release_notes' => $releaseNotes,
        ];

        // Add platform-specific info
        if ($platform === 'android') {
            $response['update_url'] = $this->capacitorUpdateUrl();
            $response['update_message'] = $forceUpdate
                ? 'A critical update is required. Please update to continue using the app.'
                : 'A new version is available with improvements and bug fixes.';
        }

        return $this->respondWithData($response);
    }

    /**
     * GET /api/app/version
     *
     * Get current app version info (public endpoint).
     */
    public function version(): JsonResponse
    {
        return $this->respondWithData([
            'version' => $this->capacitorCurrentVersion(),
            'min_version' => $this->capacitorMinimumVersion(),
            'update_url' => $this->capacitorUpdateUrl(),
            'release_notes' => self::RELEASE_NOTES[$this->capacitorCurrentVersion()] ?? [],
        ]);
    }

    /**
     * POST /api/app/log
     *
     * Log app events (crashes, errors, analytics).
     * Body: { "event": "...", "version": "...", "platform": "...", "data": {...} }
     */
    public function log(): JsonResponse
    {
        $this->rateLimit('app_log', 30, 60);

        $event = $this->input('event', 'unknown');
        $version = $this->input('version', 'unknown');
        $platform = $this->input('platform', 'unknown');
        $data = $this->input('data', []);

        // Sanitize event name to prevent log injection
        $event = preg_replace('/[^a-zA-Z0-9_.-]/', '', substr($event, 0, 64));
        $version = preg_replace('/[^a-zA-Z0-9_.-]/', '', substr($version, 0, 20));
        $platform = preg_replace('/[^a-zA-Z0-9_.-]/', '', substr($platform, 0, 20));

        /*
         * 🔴 The message carries the fault's IDENTITY only. The full payload goes in the
         * log context, NOT in the message text.
         *
         * Sentry groups a plain Log::error by its message text, and this message used to
         * embed json_encode($data) whole — including the mobile client's JS `stack`, whose
         * frames are absolute paths containing a per-install simulator/bundle UUID. Two
         * reports of the identical fault therefore never had the same message, so each one
         * opened its own Sentry issue. Measured on 2026-09-01: a single expo-secure-store
         * failure ("A required entitlement isn't present", key nexus_tenant_slug) produced
         * roughly 25 separate issues in four days — 25 of the 37 items in the nightly triage
         * queue, all one bug. Same defect class as the GDPR alarm in NEXUS-PHP-51, where
         * request ages embedded in the message re-grouped it every night.
         *
         * Nothing is lost: appLogIdentity() drops only the volatile diagnostic fields, and
         * the untouched payload is passed as log context, which reaches both the log file
         * and Sentry (as the `log_context` extra). Grouping still separates genuinely
         * different faults, because the error's name and message stay in the identity.
         */
        $line = sprintf(
            '[APP LOG] Event: %s | Version: %s | Platform: %s | Data: %s',
            $event,
            $version,
            $platform,
            json_encode(self::appLogIdentity($data))
        );

        /*
         * 🔴 The level decides whether anyone ever sees this.
         *
         * Everything used to be logged at `warning`, and the `sentry` log channel
         * captures at `error` (config/logging.php), so a mobile crash report reached the
         * log FILE and nothing else — no Sentry event, and therefore nothing in the
         * nightly triage. Since the mobile app's own Sentry is disabled in all six build
         * profiles, that made a crash on a member's phone invisible by two independent
         * routes at once.
         *
         * A genuine crash is now logged at `error` so it reaches the automated triage; the
         * analytics and warning traffic this endpoint also carries stays at `warning`, so
         * raising the level does not flood it. Event names come from
         * mobile/lib/observability/report.ts.
         *
         * Depends on production setting LOG_STACK=daily,stderr,sentry (see .env.example).
         * Without that, this still lands in the log file — which is where it landed
         * before, so the change cannot make things worse.
         */
        if ($event === 'mobile_error') {
            \Illuminate\Support\Facades\Log::error($line, ['app_log_data' => $data]);
        } else {
            \Illuminate\Support\Facades\Log::warning($line, ['app_log_data' => $data]);
        }

        return $this->respondWithData(['message' => __('api_controllers_1.app.log_recorded')]);
    }

    /**
     * Payload fields that describe WHERE a fault happened rather than WHICH fault it is.
     *
     * Every one of these carries per-install detail (absolute bundle paths, simulator and
     * application UUIDs, line offsets that move with each build), so including any of them
     * in the message defeats Sentry grouping. They stay in the log context.
     */
    private const APP_LOG_VOLATILE_KEYS = [
        'stack',
        'stacktrace',
        'stack_trace',
        'componentstack',
        'component_stack',
        'trace',
    ];

    /** Longest string kept in the identity; anything longer is diagnostic detail. */
    private const APP_LOG_IDENTITY_VALUE_MAX = 300;

    /**
     * Reduce an app-log payload to the part that identifies the fault.
     *
     * Keeps scalar fields (an error's `name`, `message`, the storage key and operation),
     * drops the volatile ones above, drops nested structures — whose shape varies between
     * clients — and sorts by key so that two clients serialising the same fields in a
     * different order still produce a byte-identical message.
     *
     * @param  mixed  $data  Raw `data` member of the request body; not necessarily an array.
     * @return mixed  A stable, bounded summary safe to use as a Sentry grouping key.
     */
    private static function appLogIdentity(mixed $data): mixed
    {
        if (is_string($data)) {
            return mb_substr($data, 0, self::APP_LOG_IDENTITY_VALUE_MAX);
        }

        if (!is_array($data)) {
            return $data;
        }

        $identity = [];

        foreach ($data as $key => $value) {
            if (in_array(strtolower((string) $key), self::APP_LOG_VOLATILE_KEYS, true)) {
                continue;
            }

            // Nested structures stay in the context: their shape is not part of the identity.
            if (is_array($value) || is_object($value)) {
                continue;
            }

            $identity[$key] = is_string($value)
                ? mb_substr($value, 0, self::APP_LOG_IDENTITY_VALUE_MAX)
                : $value;
        }

        ksort($identity);

        return $identity;
    }
}
