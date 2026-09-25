<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Exceptions\EventSafetyException;
use App\Models\User;
use App\Services\EventSafetyEligibilityService;
use App\Services\EventSafetyRequirementService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\VolunteeringConfigurationService;
use App\Services\VolunteerService;
use App\Support\Events\EventSafetyFoundationSupport;
use App\Support\SafeguardingInteractionDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Support\PublishesLegacyGuardianPolicy;
use Tests\Laravel\TestCase;

/**
 * E-035 F-160 — guardian consent is switched off, because the platform is for
 * adults only (18+). Under-18 participation is removed, not supervised.
 *
 * The tables, triggers and history stay exactly as they are (reversible); the
 * endpoints refuse with 410 GUARDIAN_CONSENT_RETIRED, the volunteering setting
 * can no longer be turned on, organisers can no longer require guardian consent
 * on an event, and a legacy published event policy that still says "guardian
 * consent required" blocks nobody.
 */
final class GuardianConsentRetiredTest extends TestCase
{
    use DatabaseTransactions;
    use PublishesLegacyGuardianPolicy;

    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function assertRetired(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(410);
        self::assertSame('GUARDIAN_CONSENT_RETIRED', $response->json('errors.0.code'));
        $message = (string) $response->json('errors.0.message');
        self::assertNotSame('api.guardian_consent_retired', $message, 'message must be translated');
        self::assertStringContainsString('18', $message);
    }

    public function test_volunteering_guardian_consent_endpoints_refuse(): void
    {
        Sanctum::actingAs($this->member());
        $this->assertRetired($this->apiGet('/v2/volunteering/guardian-consents'));
        $this->assertRetired($this->apiPost('/v2/volunteering/guardian-consents', [
            'guardian_name' => 'G',
            'guardian_email' => 'g-' . uniqid() . '@example.test',
            'relationship' => 'parent',
        ]));
        $this->assertRetired($this->apiDelete('/v2/volunteering/guardian-consents/1'));

        $token = str_repeat('a', 64);
        $this->assertRetired($this->apiGet("/v2/volunteering/guardian-consents/verify/{$token}"));
        $this->assertRetired($this->apiPost("/v2/volunteering/guardian-consents/verify/{$token}"));

        Sanctum::actingAs($this->member(['role' => 'admin']));
        $this->assertRetired($this->apiGet('/v2/admin/volunteering/guardian-consents'));
    }

    public function test_volunteering_gate_no_longer_demands_guardian_consent_or_a_date_of_birth(): void
    {
        // Even a stored "on" value from before the switch-off is inert.
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED],
            ['setting_value' => 'true', 'setting_type' => 'boolean', 'created_at' => now(), 'updated_at' => now()],
        );
        Cache::forget("volunteering_config:{$this->testTenantId}");

        self::assertFalse((bool) VolunteeringConfigurationService::get(
            VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED,
        ));
        self::assertFalse((bool) (VolunteeringConfigurationService::getAll()[VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED] ?? false));

        $noDob = $this->member(['date_of_birth' => null]);
        self::assertNull(VolunteerService::guardianConsentError((int) $noDob->id, 1));

        $recordedMinor = $this->member();
        DB::table('users')->where('id', $recordedMinor->id)
            ->update(['date_of_birth' => now()->subYears(15)->toDateString()]);
        self::assertNull(VolunteerService::guardianConsentError((int) $recordedMinor->id, 1));
    }

    public function test_the_volunteering_guardian_setting_cannot_be_turned_on(): void
    {
        Sanctum::actingAs($this->member(['role' => 'admin']));

        $response = $this->apiPut('/v2/admin/config/volunteering/bulk', [
            'settings' => [VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED => true],
        ]);
        $response->assertStatus(422);
        self::assertSame('GUARDIAN_CONSENT_RETIRED', $response->json('errors.0.code'));
        self::assertFalse(DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED)
            ->where('setting_value', 'true')
            ->exists());

        // Turning it (or keeping it) off is still accepted.
        $this->apiPut('/v2/admin/config/volunteering/bulk', [
            'settings' => [VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED => false],
        ])->assertStatus(200);
    }

    public function test_organisers_can_no_longer_require_guardian_consent_on_an_event(): void
    {
        $owner = $this->member();
        $eventId = $this->event((int) $owner->id);

        try {
            (new EventSafetyRequirementService())->saveDraft($eventId, $owner, [
                'minimum_age' => null,
                'guardian_consent_required' => true,
                'minor_age_threshold' => 16,
                'code_of_conduct_required' => false,
                'code_of_conduct_text' => null,
                'code_of_conduct_text_version' => null,
            ], 0, 'retired-guardian-draft:' . $eventId);
            self::fail('an organiser was able to require guardian consent');
        } catch (EventSafetyException $exception) {
            self::assertSame('event_guardian_consent_retired', $exception->reasonCode);
        }

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/events/{$eventId}/safety/requirements", [
            'minimum_age' => null,
            'guardian_consent_required' => true,
            'minor_age_threshold' => 16,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], ['Idempotency-Key' => 'retired-guardian-http:' . $eventId])->assertStatus(422);

        // A minimum age is unchanged and still accepted.
        $saved = (new EventSafetyRequirementService())->saveDraft($eventId, $owner, [
            'minimum_age' => 12,
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], 0, 'retired-guardian-min-age:' . $eventId);
        self::assertSame(12, (int) $saved['version']->minimum_age);
    }

    public function test_event_guardian_consent_endpoints_refuse(): void
    {
        $owner = $this->member();
        $eventId = $this->event((int) $owner->id);

        Sanctum::actingAs($owner);
        $this->assertRetired($this->apiPost("/v2/events/{$eventId}/safety/guardian-consents", [
            'guardian_name' => 'G',
            'guardian_email' => 'g-' . uniqid() . '@example.test',
            'relationship_code' => 'parent',
            'preferred_language' => 'en',
        ], ['Idempotency-Key' => 'retired-request:' . $eventId]));
        $this->assertRetired($this->apiDelete(
            "/v2/events/{$eventId}/safety/guardian-consents/1",
            [],
            ['Idempotency-Key' => 'retired-withdraw:' . $eventId],
        ));
        $this->assertRetired($this->apiPost('/v2/events/safety/guardian-consents/grant', [
            'token' => 'nxeg1_' . str_repeat('Z', 43),
            'guardian_email' => 'g@example.test',
        ], ['Idempotency-Key' => 'retired-grant:' . $eventId]));
    }

    /**
     * Safe behaviour for a policy published before the switch-off: the guardian
     * requirement is ignored — it neither demands a date of birth nor blocks
     * anyone. Everything else in the policy still applies.
     */
    public function test_a_legacy_published_policy_requiring_guardian_consent_blocks_nobody(): void
    {
        $owner = $this->member();
        $eventId = $this->event((int) $owner->id);
        $this->publishLegacyGuardianPolicy($eventId, $owner, [
            'minimum_age' => null,
            'minor_age_threshold' => 21,
            'code_of_conduct_required' => false,
        ], 'retired-legacy:' . $eventId);

        $service = $this->eligibility();
        $noDob = $this->member(['date_of_birth' => null]);
        self::assertTrue($service->evaluate($eventId, $noDob)->isAllowed());

        $young = $this->member();
        DB::table('users')->where('id', $young->id)
            ->update(['date_of_birth' => CarbonImmutable::now('UTC')->subYears(19)->toDateString()]);
        self::assertTrue($service->evaluate($eventId, User::query()->findOrFail($young->id))->isAllowed());
    }

    private function eligibility(): EventSafetyEligibilityService
    {
        $policy = $this->createMock(SafeguardingInteractionPolicy::class);
        $policy->method('evaluateLocalContact')->willReturn(new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'SAFEGUARDING_ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'event_participation',
            scopeType: 'event',
            scopeIdentifier: 'fixture',
            policyVersion: 'safeguarding-v1',
            requiredAttestationCodes: [],
            requiredAttestationLabels: [],
            canRequestCoordinator: false,
        ));

        return new EventSafetyEligibilityService(new EventSafetyFoundationSupport(), $policy);
    }

    private function event(int $ownerId): int
    {
        $start = CarbonImmutable::now('UTC')->addMonths(2)->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Guardian retirement fixture',
            'description' => 'Guardian retirement fixture.',
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
            'occurrence_key' => 'guardian-retired:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
