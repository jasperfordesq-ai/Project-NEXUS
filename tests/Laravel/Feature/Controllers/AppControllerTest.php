<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for AppController — Mobile app version check and logging.
 */
class AppControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /app/check-version
    // ------------------------------------------------------------------

    public function test_check_version_returns_status(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/app/check-version', ['version' => '1.0']);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ------------------------------------------------------------------
    //  GET /app/version
    // ------------------------------------------------------------------

    public function test_version_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/app/version');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /app/log
    // ------------------------------------------------------------------

    public function test_log_accepts_message(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/app/log', [
            'level' => 'info',
            'message' => 'Test log message',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    /**
     * Capture the messages and contexts written by AppController::log().
     *
     * @return array{0: list<string>, 1: list<array<string, mixed>>}
     */
    private function captureAppLogWrites(callable $body): array
    {
        $messages = [];
        $contexts = [];

        Log::listen(function ($record) use (&$messages, &$contexts): void {
            if (!str_starts_with((string) $record->message, '[APP LOG]')) {
                return;
            }
            $messages[] = (string) $record->message;
            $contexts[] = (array) $record->context;
        });

        $body();

        return [$messages, $contexts];
    }

    /**
     * Regression: two reports of the SAME mobile fault must produce the SAME log message.
     *
     * Sentry groups a plain Log::error by message text. The message used to embed the whole
     * payload, JS `stack` included, and those frames carry a per-install simulator/bundle
     * UUID — so one expo-secure-store failure opened roughly 25 separate Sentry issues in
     * four days and swamped the nightly triage queue. The two payloads below are the real
     * ones from issues NEXUS-PHP-5E and NEXUS-PHP-57: identical fault, different stack.
     */
    public function test_mobile_error_log_message_ignores_the_volatile_stack(): void
    {
        $this->authenticatedUser();

        $payload = static fn (string $deviceUuid, string $bundleUuid): array => [
            'event' => 'mobile_error',
            'version' => '1.2.0',
            'platform' => 'mobile',
            'data' => [
                'name' => 'Error',
                'message' => "Calling the 'setValueWithKeyAsync' function has failed\n"
                    . "→ Caused by: A required entitlement isn't present.",
                'stack' => "Error: Calling the 'setValueWithKeyAsync' function has failed\n"
                    . "    at _construct (address at /Users/runner/Library/Developer/CoreSimulator"
                    . "/Devices/{$deviceUuid}/data/Containers/Bundle/Application/{$bundleUuid}"
                    . '/TimebankGlobal.app/main.jsbundle:1:297566)',
                'storage_op' => 'set',
                'key' => 'nexus_tenant_slug',
            ],
        ];

        [$messages, $contexts] = $this->captureAppLogWrites(function () use ($payload): void {
            $this->apiPost('/app/log', $payload(
                '0B6F696B-F051-4C60-981E-8C9D0F11DA71',
                '9BAF56A4-DBB7-4733-8969-A721D7B0E726'
            ));
            $this->apiPost('/app/log', $payload(
                '5281BDD8-CB9A-475E-B93E-988E84A2039C',
                '7F574569-79E2-4CAB-869B-E11EBB710CA2'
            ));
        });

        $this->assertCount(2, $messages, 'Both reports should have been logged.');
        $this->assertSame(
            $messages[0],
            $messages[1],
            'One fault reported twice must log a byte-identical message, or Sentry opens a '
            . 'new issue for every device it happens on.'
        );

        // The identity must still name the fault, or unrelated faults would all merge.
        $this->assertStringContainsString('setValueWithKeyAsync', $messages[0]);
        $this->assertStringContainsString('nexus_tenant_slug', $messages[0]);

        // The stack is not lost — it moves to the log context, which still reaches Sentry.
        $this->assertStringNotContainsString('CoreSimulator', $messages[0]);
        $this->assertStringContainsString(
            'CoreSimulator',
            (string) ($contexts[0]['app_log_data']['stack'] ?? ''),
            'The stack must still be recorded, in the log context rather than the message.'
        );
    }

    /** A genuinely different fault must NOT be merged into the same Sentry group. */
    public function test_different_mobile_errors_still_log_different_messages(): void
    {
        $this->authenticatedUser();

        [$messages] = $this->captureAppLogWrites(function (): void {
            $this->apiPost('/app/log', [
                'event' => 'mobile_error',
                'version' => '1.2.0',
                'platform' => 'mobile',
                'data' => ['name' => 'Error', 'message' => 'Keychain write refused'],
            ]);
            $this->apiPost('/app/log', [
                'event' => 'mobile_error',
                'version' => '1.2.0',
                'platform' => 'mobile',
                'data' => ['name' => 'TypeError', 'message' => 'Network request failed'],
            ]);
        });

        $this->assertCount(2, $messages);
        $this->assertNotSame($messages[0], $messages[1]);
    }

    /** Key order is a client serialisation detail, not part of the fault's identity. */
    public function test_log_message_is_stable_across_payload_key_order(): void
    {
        $this->authenticatedUser();

        [$messages] = $this->captureAppLogWrites(function (): void {
            $this->apiPost('/app/log', [
                'event' => 'mobile_error',
                'version' => '1.2.0',
                'platform' => 'mobile',
                'data' => ['name' => 'Error', 'message' => 'Keychain write refused'],
            ]);
            $this->apiPost('/app/log', [
                'event' => 'mobile_error',
                'version' => '1.2.0',
                'platform' => 'mobile',
                'data' => ['message' => 'Keychain write refused', 'name' => 'Error'],
            ]);
        });

        $this->assertCount(2, $messages);
        $this->assertSame($messages[0], $messages[1]);
    }
}
