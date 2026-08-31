<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;

class NativePushProducerInventoryTest extends TestCase
{
    public function test_committed_native_push_inventory_matches_every_current_producer(): void
    {
        $command = escapeshellarg(PHP_BINARY) . ' '
            . escapeshellarg(base_path('mobile/scripts/audit-native-push-producers.php'))
            . ' --check 2>&1';
        exec($command, $output, $status);

        self::assertSame(0, $status, implode("\n", $output));

        $inventory = json_decode(
            (string) file_get_contents(base_path('mobile/config/native-push-producer-inventory.json')),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertSame(3, $inventory['schema_version']);
        self::assertSame(count($inventory['producers']), $inventory['producer_count']);
        self::assertGreaterThan(220, $inventory['producer_count']);
    }

    public function test_job_workflows_do_not_duplicate_dispatcher_pushes_through_realtime(): void
    {
        $paths = [
            base_path('app/Listeners/NotifyJobAlertSubscribers.php'),
            base_path('app/Services/JobInterviewService.php'),
            base_path('app/Services/JobOfferService.php'),
            base_path('app/Services/JobVacancyService.php'),
        ];
        $source = implode("\n", array_map(
            static fn (string $path): string => (string) file_get_contents($path),
            $paths,
        ));

        self::assertStringNotContainsString('RealtimeService::broadcastAndPush(', $source);
        self::assertSame(13, substr_count($source, 'RealtimeService::broadcastOnly('));
        self::assertGreaterThanOrEqual(13, substr_count($source, 'NotificationDispatcher::fanOutPush('));
    }

    public function test_every_dispatcher_helper_that_reaches_native_push_is_a_known_entry_point(): void
    {
        $source = (string) file_get_contents(base_path('app/Services/NotificationDispatcher.php'));
        preg_match_all(
            '/(?:public|private|protected)\s+static\s+function\s+([A-Za-z0-9_]+)|self::fanOutPush\s*\(/',
            $source,
            $matches,
            PREG_SET_ORDER,
        );

        $method = null;
        $pushMethods = [];
        foreach ($matches as $match) {
            if (($match[1] ?? '') !== '') {
                $method = $match[1];
                continue;
            }
            if ($method !== null) {
                $pushMethods[] = $method;
            }
        }

        self::assertSame([
            'dispatchForResolvedTenant',
            'dispatchHotMatch',
            'dispatchMutualMatch',
            'dispatchMatchDigest',
            'dispatchMatchApprovalRequest',
            'dispatchMatchApproved',
            'dispatchMatchRejected',
            'send',
            'notifyAdmins',
            'notifyModerationAdmins',
            'dispatchVerificationPassed',
            'dispatchVerificationFailed',
        ], $pushMethods);
    }

    public function test_job_application_notification_uses_the_shared_web_and_native_applications_link(): void
    {
        $source = (string) file_get_contents(base_path('app/Http/Controllers/Api/JobVacanciesController.php'));

        // The stored destination powers both the React notification bell and the
        // native push. React owns the fragment route; the native intent mapper
        // converts the same link to the implemented employer pipeline screen.
        self::assertSame(2, substr_count($source, '"/jobs/{$id}#applications"'));
    }
}
