<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventSafetyException;
use App\Models\Group;
use App\Models\User;
use App\Services\EventDomainOutboxService;
use App\Services\EventGuardianConsentDeliveryEnvelope;
use App\Services\EventGuardianConsentDeliveryEnvelopeService;
use App\Services\EventGuardianConsentService;
use App\Services\EventGuardianLocaleResolver;
use App\Services\EventNotificationOutboxActionHandler;
use App\Services\EventSafetyRequirementService;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

final class EventSafetyGuardianDeliveryBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $configuration = json_decode((string) ($tenant?->configuration ?? '{}'), true);
        $configuration = is_array($configuration) ? $configuration : [];
        $configuration['supported_languages'] = EventGuardianLocaleResolver::PLATFORM_LOCALES;
        $configuration['default_language'] = 'en';
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_guardian_delivery_rollback_refuses_phase_b_delivery_dependency(): void
    {
        /** @var Migration $migration */
        $migration = require database_path(
            'migrations/2026_07_11_000061_add_event_guardian_delivery_boundary.php',
        );

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage(
            'event_guardian_delivery_rollback_refused_dependents_exist',
        );
        $migration->down();
    }

    public function test_expand_migration_enforces_xor_and_composite_scope(): void
    {
        self::assertTrue(Schema::hasColumn('event_notification_deliveries', 'external_recipient_hash'));
        self::assertTrue(Schema::hasColumn('event_guardian_consents', 'guardian_locale'));
        self::assertTrue(Schema::hasTable('event_guardian_consent_delivery_envelopes'));
        self::assertTrue(Schema::hasTable('event_guardian_consent_delivery_access'));

        $constraints = DB::table('information_schema.TABLE_CONSTRAINTS')
            ->where('CONSTRAINT_SCHEMA', DB::getDatabaseName())
            ->whereIn('CONSTRAINT_NAME', [
                'chk_event_delivery_recipient_xor',
                'chk_event_delivery_external_hash',
                'fk_event_guardian_delivery_consent',
                'fk_event_guardian_delivery_outbox',
                'fk_event_guardian_delivery_access_envelope',
                'fk_event_guardian_delivery_access_consent',
                'fk_event_guardian_delivery_access_outbox',
            ])
            ->pluck('CONSTRAINT_NAME')
            ->all();
        self::assertCount(7, array_unique($constraints));

        [$context, $secrets] = $this->requestedConsent('de-DE');
        $otherEventId = $this->event((int) $context['owner']->id);
        $otherOutbox = (new EventDomainOutboxService())->record(
            $this->testTenantId,
            $otherEventId,
            1,
            'event.safety.guardian_consent.requested',
            'guardian-cross-scope-' . bin2hex(random_bytes(8)),
            [
                'schema_version' => 1,
                'tenant_id' => $this->testTenantId,
                'event_id' => $otherEventId,
                'consent_id' => (int) $context['consent']->id,
            ],
            \App\Enums\EventNotificationDeliveryMode::OutboxAuthoritative,
        );
        $this->assertQueryRejected(function () use ($context, $otherEventId, $otherOutbox): void {
            DB::table('event_guardian_consent_delivery_envelopes')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $otherEventId,
                'consent_id' => (int) $context['consent']->id,
                'outbox_id' => (int) $otherOutbox['id'],
                'consent_version' => 2,
                'action' => 'event.safety.guardian_consent.requested',
                'cipher_version' => 'aes-256-gcm-v1',
                'key_version' => 'app-key-v1',
                'key_fingerprint' => str_repeat('a', 64),
                'aad_hash' => str_repeat('b', 64),
                'token_ciphertext' => 'sealed',
                'status' => 'sealed',
                'envelope_version' => 1,
                'expires_at' => now()->addDay(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
        $this->assertSecretsAbsentFromDurableDelivery($context, $secrets);
    }

    public function test_request_seals_token_atomically_and_access_evidence_is_append_only(): void
    {
        [$context, $secrets] = $this->requestedConsent('de-DE');
        self::assertSame('de', $context['consent']->getRawOriginal('guardian_locale'));
        self::assertSame('outbox_authoritative', (string) $context['outbox']->production_mode);
        self::assertSame('pending', (string) $context['outbox']->status);
        self::assertSame('sealed', (string) $context['envelope']->status);
        self::assertNotNull($context['envelope']->token_ciphertext);
        self::assertSame(1, DB::table('event_guardian_consent_delivery_access')
            ->where('envelope_id', (int) $context['envelope']->id)
            ->where('operation', 'sealed')
            ->count());

        $service = new EventGuardianConsentDeliveryEnvelopeService();
        $claim = $service->claimForDelivery(
            (int) $context['outbox']->id,
            'test-worker',
            'test-delivery-key',
        );
        self::assertSame(
            hash('sha256', $secrets['token']),
            hash('sha256', $claim->guardianToken),
        );
        $this->assertReason(
            fn () => $service->claimForDelivery(
                (int) $context['outbox']->id,
                'test-worker',
                'test-delivery-key',
            ),
            'event_guardian_delivery_envelope_already_claimed',
        );
        $resumed = $service->resumeClaimForDelivery(
            (int) $context['outbox']->id,
            'test-worker',
            'test-delivery-key',
        );
        self::assertSame(
            hash('sha256', $claim->guardianToken),
            hash('sha256', $resumed->guardianToken),
        );
        $service->completeHandoff(
            (int) $claim->envelope->id,
            $claim->claimToken,
            'test-worker',
            'test-handoff-key',
        );
        $stored = DB::table('event_guardian_consent_delivery_envelopes')
            ->where('id', (int) $claim->envelope->id)
            ->firstOrFail();
        self::assertSame('handed_off', $stored->status);
        self::assertNull($stored->token_ciphertext);
        self::assertNotNull($stored->erased_at);

        $accessId = (int) DB::table('event_guardian_consent_delivery_access')
            ->where('envelope_id', (int) $claim->envelope->id)
            ->value('id');
        $this->assertQueryRejected(
            fn () => DB::table('event_guardian_consent_delivery_access')
                ->where('id', $accessId)
                ->update(['operation' => 'tampered']),
        );
        $this->assertQueryRejected(
            fn () => DB::table('event_guardian_consent_delivery_access')
                ->where('id', $accessId)
                ->delete(),
        );
        $this->assertSecretsAbsentFromDurableDelivery($context, $secrets);
    }

    public function test_private_group_nonmember_cannot_create_guardian_consent_side_effects(): void
    {
        $owner = $this->user();
        $start = CarbonImmutable::now('UTC')->addMonths(2)->startOfDay()->addHours(10);
        $minor = $this->user([
            'date_of_birth' => $start->subYears(16)->addDay()->toDateString(),
        ]);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => (int) $owner->id,
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
        ]);
        $eventId = $this->event((int) $owner->id, $start);
        DB::table('events')->where('id', $eventId)->update(['group_id' => (int) $group->id]);

        $requirements = new EventSafetyRequirementService();
        $draft = $requirements->saveDraft($eventId, $owner, [
            'minimum_age' => null,
            'guardian_consent_required' => true,
            'minor_age_threshold' => 18,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], 0, 'private-guardian-policy-draft-' . bin2hex(random_bytes(6)));
        $requirements->publish(
            $eventId,
            $owner,
            (int) $draft['requirements']->revision,
            (int) $draft['version']->version_number,
            'private-guardian-policy-publish-' . bin2hex(random_bytes(6)),
        );

        $exception = null;
        try {
            (new EventGuardianConsentService())->requestWithDelivery(
                $eventId,
                $minor,
                $minor,
                [
                    'guardian_name' => 'Private Guardian',
                    'guardian_email' => 'private-guardian@example.test',
                    'relationship_code' => 'guardian',
                ],
                'en',
                'private-guardian-request-' . bin2hex(random_bytes(6)),
            );
        } catch (EventSafetyException $caught) {
            $exception = $caught;
        }

        self::assertSame('event_safety_authorization_denied', $exception?->getMessage());
        self::assertSame(0, DB::table('event_guardian_consents')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_guardian_consent_history')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.safety.guardian_consent.requested')
            ->count());
        self::assertSame(0, DB::table('event_guardian_consent_delivery_envelopes')->where('event_id', $eventId)->count());

        $managerException = null;
        try {
            (new EventGuardianConsentService())->requestWithDelivery(
                $eventId,
                $minor,
                $owner,
                [
                    'guardian_name' => 'Manager Requested Guardian',
                    'guardian_email' => 'manager-guardian@example.test',
                    'relationship_code' => 'guardian',
                ],
                'en',
                'private-manager-request-' . bin2hex(random_bytes(6)),
            );
        } catch (EventSafetyException $caught) {
            $managerException = $caught;
        }

        self::assertSame('event_safety_authorization_denied', $managerException?->getMessage());
        self::assertSame(0, DB::table('event_guardian_consents')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_guardian_consent_history')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.safety.guardian_consent.requested')
            ->count());
        self::assertSame(0, DB::table('event_guardian_consent_delivery_envelopes')->where('event_id', $eventId)->count());

        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'user_id' => (int) $minor->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $permitted = (new EventGuardianConsentService())->requestWithDelivery(
            $eventId,
            $minor,
            $owner,
            [
                'guardian_name' => 'Private Guardian',
                'guardian_email' => 'private-guardian@example.test',
                'relationship_code' => 'guardian',
            ],
            'en',
            'private-guardian-permitted-' . bin2hex(random_bytes(6)),
        );

        self::assertTrue($permitted['changed']);
        self::assertSame(1, DB::table('event_guardian_consents')->where('event_id', $eventId)->count());
        self::assertSame(1, DB::table('event_guardian_consent_history')->where('event_id', $eventId)->count());
        self::assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.safety.guardian_consent.requested')
            ->count());
        self::assertSame(1, DB::table('event_guardian_consent_delivery_envelopes')->where('event_id', $eventId)->count());
    }

    public function test_external_delivery_is_idempotent_and_cannot_alias_internal_recipient(): void
    {
        [$context, $secrets] = $this->requestedConsent('fr');
        $hash = (string) $context['consent']->getRawOriginal('guardian_email_blind_hash');
        $key = EventDomainOutboxService::externalDeliveryKey(
            $this->testTenantId,
            (int) $context['event_id'],
            'event.safety.guardian_consent.requested',
            $hash,
            'email',
            1,
        );
        $outbox = new EventDomainOutboxService();
        $first = $outbox->ensureExternalDelivery(
            (int) $context['outbox']->id,
            $hash,
            'email',
            $key,
        );
        $replay = $outbox->ensureExternalDelivery(
            (int) $context['outbox']->id,
            $hash,
            'email',
            $key,
        );
        self::assertSame((int) $first['id'], (int) $replay['id']);
        self::assertNull($first['recipient_user_id']);
        self::assertSame($hash, $first['external_recipient_hash']);

        $this->assertQueryRejected(function () use ($context, $hash): void {
            DB::table('event_notification_deliveries')->insert([
                'tenant_id' => $this->testTenantId,
                'outbox_id' => (int) $context['outbox']->id,
                'recipient_user_id' => (int) $context['minor']->id,
                'external_recipient_hash' => $hash,
                'channel' => 'email',
                'delivery_key' => hash('sha256', 'invalid-xor'),
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
        $this->assertQueryRejected(function () use ($context, $hash): void {
            DB::table('event_notification_deliveries')->insert([
                'tenant_id' => $this->testTenantId,
                'outbox_id' => (int) $context['outbox']->id,
                'recipient_user_id' => null,
                'external_recipient_hash' => $hash,
                'channel' => 'email',
                'delivery_key' => hash('sha256', 'duplicate-external'),
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
        self::assertSame(1, DB::table('event_notification_deliveries')
            ->where('outbox_id', (int) $context['outbox']->id)
            ->where('external_recipient_hash', $hash)
            ->where('channel', 'email')
            ->count());
        $this->assertSecretsAbsentFromDurableDelivery($context, $secrets);
    }

    public function test_guardian_locale_is_bcp47_validated_with_explicit_fallbacks(): void
    {
        $minor = $this->user(['preferred_language' => 'fr']);
        $resolver = new EventGuardianLocaleResolver();
        self::assertSame('de', $resolver->resolve('de-DE', $minor));
        self::assertSame('fr', $resolver->resolve(null, $minor));
        $this->assertReason(
            fn () => $resolver->resolve('zz-ZZ', $minor),
            'event_guardian_locale_unsupported',
        );
        $this->assertReason(
            fn () => $resolver->resolve('../de', $minor),
            'event_guardian_locale_invalid',
        );
    }

    public function test_outbox_handler_renders_external_email_in_guardian_locale_and_erases_token(): void
    {
        [$context, $secrets] = $this->requestedConsent('de-DE');
        $observedLocale = null;
        $observedSubjectHash = null;
        $handler = new EventNotificationOutboxActionHandler(
            guardianEnvelope: new EventGuardianConsentDeliveryEnvelope(),
            guardianSender: static function (
                string $_recipient,
                string $subject,
                string $_html,
                string $locale,
                string $_deliveryKey,
                string $_recipientHash,
            ) use (&$observedLocale, &$observedSubjectHash): bool {
                $observedLocale = $locale;
                $observedSubjectHash = hash('sha256', $subject);

                return true;
            },
        );
        $outbox = (array) $context['outbox'];
        $outbox['payload'] = json_decode((string) $context['outbox']->payload, true, 32, JSON_THROW_ON_ERROR);
        $result = $handler->handle($outbox);

        self::assertSame(1, $result->recipients);
        self::assertSame(1, $result->delivered);
        self::assertSame('de', $observedLocale);
        self::assertSame(
            hash('sha256', __('emails.event_guardian_consent.subject', [
                'event' => 'Guardian delivery fixture',
            ], 'de')),
            $observedSubjectHash,
        );
        $delivery = DB::table('event_notification_deliveries')
            ->where('outbox_id', (int) $context['outbox']->id)
            ->firstOrFail();
        self::assertNull($delivery->recipient_user_id);
        self::assertSame('delivered', $delivery->status);
        self::assertSame(64, strlen((string) $delivery->external_recipient_hash));
        $envelope = DB::table('event_guardian_consent_delivery_envelopes')
            ->where('outbox_id', (int) $context['outbox']->id)
            ->firstOrFail();
        self::assertSame('handed_off', $envelope->status);
        self::assertNull($envelope->token_ciphertext);
        $this->assertSecretsAbsentFromDurableDelivery($context, $secrets);
    }

    /** @return array{0:array<string,mixed>,1:array<string,string>} */
    private function requestedConsent(string $locale): array
    {
        $owner = $this->user();
        $start = CarbonImmutable::now('UTC')->addMonths(2)->startOfDay()->addHours(10);
        $minor = $this->user([
            'date_of_birth' => $start->subYears(16)->addDay()->toDateString(),
            'preferred_language' => 'en',
        ]);
        $eventId = $this->event((int) $owner->id, $start);
        $requirements = new EventSafetyRequirementService();
        $draft = $requirements->saveDraft($eventId, $owner, [
            'minimum_age' => null,
            'guardian_consent_required' => true,
            'minor_age_threshold' => 18,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], 0, 'guardian-delivery-policy-draft-' . bin2hex(random_bytes(6)));
        $requirements->publish(
            $eventId,
            $owner,
            (int) $draft['requirements']->revision,
            (int) $draft['version']->version_number,
            'guardian-delivery-policy-publish-' . bin2hex(random_bytes(6)),
        );

        $support = new EventSafetyFoundationSupport();
        $secrets = [
            'token' => $support->guardianToken(),
            'email' => 'external-' . bin2hex(random_bytes(8)) . '@example.test',
            'name' => 'External ' . bin2hex(random_bytes(5)),
        ];
        $service = new EventGuardianConsentService(
            $support,
            fn (): string => $secrets['token'],
        );
        $result = $service->requestWithDelivery(
            $eventId,
            $minor,
            $minor,
            [
                'guardian_name' => $secrets['name'],
                'guardian_email' => $secrets['email'],
                'relationship_code' => 'guardian',
            ],
            $locale,
            'guardian-delivery-request-' . bin2hex(random_bytes(6)),
        );
        $outbox = DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.safety.guardian_consent.requested')
            ->firstOrFail();
        $envelope = DB::table('event_guardian_consent_delivery_envelopes')
            ->where('outbox_id', (int) $outbox->id)
            ->firstOrFail();

        return [[
            'owner' => $owner,
            'minor' => $minor,
            'event_id' => $eventId,
            'consent' => $result['consent'],
            'outbox' => $outbox,
            'envelope' => $envelope,
        ], $secrets];
    }

    /** @param array<string,mixed> $context @param array<string,string> $secrets */
    private function assertSecretsAbsentFromDurableDelivery(array $context, array $secrets): void
    {
        $rows = [
            DB::table('event_domain_outbox')->where('id', (int) $context['outbox']->id)->first(),
            DB::table('event_guardian_consent_delivery_envelopes')->where('outbox_id', (int) $context['outbox']->id)->first(),
            DB::table('event_guardian_consent_delivery_access')->where('outbox_id', (int) $context['outbox']->id)->get()->all(),
            DB::table('event_notification_deliveries')->where('outbox_id', (int) $context['outbox']->id)->get()->all(),
        ];
        $encoded = json_encode($rows, JSON_THROW_ON_ERROR);
        foreach ($secrets as $secret) {
            self::assertStringNotContainsString($secret, $encoded);
        }
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(int $ownerId, ?CarbonImmutable $start = null): int
    {
        $start ??= CarbonImmutable::now('UTC')->addMonths(3)->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Guardian delivery fixture',
            'description' => 'Fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'calendar_sequence' => 1,
            'is_recurring_template' => false,
            'occurrence_key' => 'guardian-delivery:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param callable():mixed $operation */
    private function assertReason(callable $operation, string $reason): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventSafetyException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }

    /** @param callable():mixed $operation */
    private function assertQueryRejected(callable $operation): void
    {
        try {
            $operation();
            self::fail('Expected database integrity rejection.');
        } catch (QueryException) {
            self::assertTrue(true);
        }
    }
}
