<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use PHPUnit\Framework\TestCase;

final class EventBroadcastPhaseBStaticTest extends TestCase
{
    public function test_audience_expansion_is_canonical_only_and_safeguarding_gated(): void
    {
        $source = $this->source('app/Services/EventBroadcastAudienceResolver.php');

        self::assertStringContainsString("'event_registrations'", $source);
        self::assertStringContainsString("'event_waitlist_entries'", $source);
        self::assertStringContainsString("'event_attendance'", $source);
        self::assertStringContainsString('EventCapacityRegistrationState::Confirmed', $source);
        self::assertStringContainsString('EventWaitlistQueueState::Waiting', $source);
        self::assertStringContainsString('EventAttendanceState::Attended', $source);
        self::assertStringContainsString('assertCommunitySpaceBroadcastAllowed', $source);
        self::assertStringNotContainsString('event_rsvps', $source);
        self::assertStringNotContainsString("DB::table('event_waitlist')", $source);
    }

    public function test_service_freezes_exact_recipients_before_any_delivery(): void
    {
        $source = $this->source('app/Services/EventBroadcastService.php');

        self::assertStringContainsString('recipient_count', $source);
        self::assertStringContainsString('delivery_count', $source);
        self::assertStringContainsString('insertDeliveries(', $source);
        self::assertStringContainsString('broadcast_version', $source);
        self::assertStringContainsString('idempotency_hash', $source);
        self::assertStringContainsString('event_broadcast_cancel_after_send_forbidden', $source);
        self::assertStringContainsString('EventBroadcastAction::Retried', $source);
        self::assertStringNotContainsString('notifyAttendees(', $source);
        self::assertStringNotContainsString('Notification::create', $source);
        self::assertStringNotContainsString('event_rsvps', $source);
    }

    public function test_delivery_consumer_is_locale_preference_and_policy_aware(): void
    {
        $source = $this->source('app/Services/EventBroadcastDeliveryConsumer.php');

        self::assertStringContainsString('LocaleContext::withLocale', $source);
        self::assertStringContainsString('EventNotificationPreferenceResolver::resolveForEvent', $source);
        self::assertStringContainsString('assertCommunitySpaceContactAllowed', $source);
        self::assertStringContainsString('event_broadcast_delivery_attempts', $source);
        self::assertStringContainsString('DeadLetter', $source);
        self::assertStringContainsString('next_attempt_at', $source);
        self::assertStringContainsString('recipient_reference_fingerprint', $source);
        self::assertStringNotContainsString("'recipient_user_id' =>", $source);
        self::assertStringNotContainsString("'claim_token' => (string)", $source);
    }

    public function test_renderer_translates_wrapper_without_mutating_authored_body(): void
    {
        $renderer = $this->source('app/Services/EventBroadcastRenderer.php');
        $support = $this->source('app/Support/Events/EventBroadcastFoundationSupport.php');

        self::assertStringContainsString('subjectTranslationKey()', $renderer);
        self::assertStringContainsString('headingTranslationKey()', $renderer);
        self::assertStringContainsString("__('emails.common.fallback_name')", $renderer);
        self::assertStringContainsString("'emails.events.view_event'", $renderer);
        self::assertStringContainsString('message: $body', $renderer);
        self::assertStringContainsString('Do not trim, normalize, translate', $support);
        self::assertStringContainsString('return $body;', $support);
    }

    public function test_all_locales_ship_the_broadcast_email_wrapper_contract(): void
    {
        foreach (['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as $locale) {
            $path = $this->root() . "/lang/{$locale}/emails.json";
            $translations = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
            self::assertIsArray($translations);
            $events = $translations['events'] ?? null;
            self::assertIsArray($events, "Missing Events email translations in {$locale}");
            foreach ([
                'broadcast_subject',
                'follow_up_subject',
                'review_request_subject',
                'broadcast_heading',
                'follow_up_heading',
                'review_request_heading',
                'leave_event_review',
            ] as $key) {
                self::assertIsString($events[$key] ?? null, "Missing {$locale} events.{$key}");
            }
        }
    }

    public function test_push_delivery_stays_inside_the_durable_worker(): void
    {
        $source = $this->source('app/Services/EventBroadcastChannelDispatcher.php');

        self::assertStringContainsString('WebPushService::sendToUserStatic', $source);
        self::assertStringContainsString('FCMPushService::sendToUser', $source);
        self::assertStringContainsString("['event_delivery_key' => \$deliveryKey]", $source);
        self::assertStringNotContainsString('NotificationDispatcher::fanOutPush', $source);
        self::assertStringNotContainsString('afterResponse', $source);
    }

    public function test_schema_has_immutable_lifecycle_and_per_recipient_evidence(): void
    {
        $source = $this->source(
            'database/migrations/2026_07_11_000062_create_event_broadcast_foundation.php',
        );

        foreach ([
            'event_broadcasts',
            'event_broadcast_history',
            'event_broadcast_deliveries',
            'event_broadcast_delivery_attempts',
        ] as $table) {
            self::assertStringContainsString($table, $source);
        }
        self::assertStringContainsString("'recipient_user_id'", $source);
        self::assertStringContainsString("'dead_lettered_at'", $source);
        self::assertStringContainsString("'idempotency_hash'", $source);
        self::assertStringContainsString('event_broadcast_evidence_immutable', $source);
        self::assertStringContainsString('event_broadcast_content_frozen', $source);
        self::assertStringContainsString('event_broadcast_terminal_immutable', $source);
        self::assertStringContainsString('event_broadcast_delivery_identity_immutable', $source);
        self::assertStringContainsString('event_broadcast_delivery_terminal_immutable', $source);
        self::assertStringContainsString('event_broadcast_rollback_refused_evidence_exists', $source);
    }

    public function test_event_policy_has_a_dedicated_broadcast_ability(): void
    {
        $source = $this->source('app/Policies/EventPolicy.php');

        self::assertStringContainsString('public function broadcast(User $user, Event $event): bool', $source);
        self::assertStringContainsString('EventStaffCapability::Broadcast->value', $source);
    }

    public function test_public_resources_and_diagnostics_do_not_expose_delivery_identity(): void
    {
        $resource = $this->source('app/Http/Resources/EventBroadcastResource.php')
            . $this->source('app/Http/Resources/EventBroadcastHistoryResource.php');
        $diagnostics = $this->source('app/Services/EventBroadcastDiagnostics.php');

        foreach (['recipient_user_id', 'claim_token', 'provider_evidence_id', 'actor_user_id'] as $private) {
            self::assertStringNotContainsString("'{$private}' =>", $resource);
            self::assertStringNotContainsString($private, $diagnostics);
        }
        self::assertStringNotContainsString("'body'", $diagnostics);
        self::assertStringNotContainsString('last_error', $diagnostics);
    }

    public function test_worker_entrypoint_is_bounded_and_identity_free(): void
    {
        $source = $this->source('app/Console/Commands/ProcessEventBroadcastDeliveries.php');

        self::assertStringContainsString('events:process-broadcasts', $source);
        self::assertStringContainsString("'max_range' => 100", $source);
        self::assertStringContainsString("\$summary['dead_lettered']", $source);
        self::assertStringNotContainsString('recipient_user_id', $source);
        self::assertStringNotContainsString('claim_token', $source);
        self::assertStringNotContainsString('provider_evidence_id', $source);
    }

    private function source(string $relative): string
    {
        $path = $this->root() . '/' . $relative;
        $source = file_get_contents($path);
        self::assertIsString($source, "Could not read {$relative}");

        return $source;
    }

    private function root(): string
    {
        return dirname(__DIR__, 4);
    }
}
