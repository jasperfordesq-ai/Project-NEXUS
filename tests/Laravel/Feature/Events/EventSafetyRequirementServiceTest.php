<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventSafetyException;
use App\Models\User;
use App\Services\EventSafetyRequirementService;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventSafetyRequirementServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_requirement_versions_preserve_exact_policy_and_actor_history(): void
    {
        $owner = $this->user();
        $eventId = $this->event((int) $owner->id);
        $service = new EventSafetyRequirementService();
        $code = "  Event code of conduct\nKeep the original spacing.  ";

        $draft = $service->saveDraft(
            $eventId,
            $owner,
            [
                'minimum_age' => 12,
                'guardian_consent_required' => false,
                'minor_age_threshold' => null,
                'code_of_conduct_required' => true,
                'code_of_conduct_text' => $code,
                'code_of_conduct_text_version' => '2026.07-a',
            ],
            0,
            'requirements-exact-draft',
        );

        self::assertTrue($draft['changed']);
        self::assertSame('draft', $draft['requirements']->getRawOriginal('status'));
        self::assertSame(1, (int) $draft['requirements']->revision);
        self::assertSame(1, (int) $draft['version']->version_number);
        self::assertSame($code, $draft['version']->code_of_conduct_text);
        self::assertSame(hash('sha256', $code), $draft['version']->code_of_conduct_text_hash);
        self::assertSame(
            (new EventSafetyFoundationSupport())->eligibilityPolicyMetadata(),
            $draft['version']->eligibility_policy_metadata,
        );
        self::assertSame((int) $owner->id, (int) $draft['version']->captured_by_user_id);

        $published = $service->publish(
            $eventId,
            $owner,
            1,
            1,
            'requirements-exact-publish',
        );
        self::assertTrue($published['changed']);
        self::assertSame('published', $published['requirements']->getRawOriginal('status'));
        self::assertSame(2, (int) $published['requirements']->revision);
        self::assertSame(1, (int) $published['requirements']->published_version);
        self::assertSame((int) $owner->id, (int) $published['requirements']->published_by_user_id);

        $history = DB::table('event_safety_requirement_history')
            ->where('event_id', $eventId)
            ->orderBy('requirements_revision')
            ->get();
        self::assertCount(2, $history);
        self::assertSame(['saved', 'published'], $history->pluck('action')->all());
        self::assertSame([(int) $owner->id, (int) $owner->id], $history->pluck('actor_user_id')->all());
    }

    public function test_optimistic_revisions_idempotency_and_archive_are_stable(): void
    {
        $owner = $this->user();
        $eventId = $this->event((int) $owner->id);
        $service = new EventSafetyRequirementService();
        $configuration = $this->configuration();

        $draft = $service->saveDraft(
            $eventId,
            $owner,
            $configuration,
            0,
            'requirements-stable-draft',
        );
        $replay = $service->saveDraft(
            $eventId,
            $owner,
            $configuration,
            0,
            'requirements-stable-draft',
        );
        self::assertFalse($replay['changed']);
        self::assertSame((int) $draft['version']->id, (int) $replay['version']->id);
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $owner,
                array_replace($configuration, ['minimum_age' => 21]),
                0,
                'requirements-stable-draft',
            ),
            'event_safety_idempotency_conflict',
        );
        $this->assertReason(
            fn () => $service->publish(
                $eventId,
                $owner,
                99,
                1,
                'requirements-stale-publish',
            ),
            'event_safety_requirements_revision_conflict',
        );

        $published = $service->publish(
            $eventId,
            $owner,
            1,
            1,
            'requirements-stable-publish',
        );
        $revised = $service->saveDraft(
            $eventId,
            $owner,
            array_replace($configuration, [
                'code_of_conduct_text' => 'Revised conduct policy.',
                'code_of_conduct_text_version' => 'v2',
            ]),
            (int) $published['requirements']->revision,
            'requirements-stable-revision',
        );
        self::assertSame(3, (int) $revised['requirements']->revision);
        self::assertSame(2, (int) $revised['requirements']->current_version);
        self::assertSame('draft', $revised['requirements']->getRawOriginal('status'));
        self::assertNull($revised['requirements']->published_version);

        $archived = $service->archive(
            $eventId,
            $owner,
            3,
            2,
            'requirements-stable-archive',
        );
        self::assertSame('archived', $archived['requirements']->getRawOriginal('status'));
        self::assertSame(4, (int) $archived['requirements']->revision);
        $archiveReplay = $service->archive(
            $eventId,
            $owner,
            3,
            2,
            'requirements-stable-archive',
        );
        self::assertFalse($archiveReplay['changed']);
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $owner,
                $configuration,
                4,
                'requirements-after-archive',
            ),
            'event_safety_requirements_archived',
        );

        self::assertDatabaseCount('event_safety_requirement_versions', 2);
        self::assertDatabaseCount('event_safety_requirement_history', 4);
    }

    public function test_requirement_boundaries_fail_closed_without_country_age_defaults(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $inactive = $this->user(['status' => 'inactive']);
        $foreign = $this->user([], 999);
        $eventId = $this->event((int) $owner->id);
        $recurringId = $this->event((int) $owner->id, [], $this->testTenantId, true);
        $foreignEventId = $this->event((int) $foreign->id, [], 999);
        $service = new EventSafetyRequirementService();

        // Adults-only platform (2026-09-25): guardian consent is switched off,
        // so requiring it is refused, and a minor-age threshold without it is
        // still refused by the existing minor-policy rule.
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $owner,
                array_replace($this->configuration(), [
                    'guardian_consent_required' => true,
                    'minor_age_threshold' => 18,
                ]),
                0,
                'requirements-guardian-retired',
            ),
            'event_guardian_consent_retired',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $owner,
                array_replace($this->configuration(), ['minor_age_threshold' => 18]),
                0,
                'requirements-threshold-without-guardian',
            ),
            'event_safety_minor_policy_invalid',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $member,
                $this->configuration(),
                0,
                'requirements-member-forbidden',
            ),
            'event_safety_authorization_denied',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $inactive,
                $this->configuration(),
                0,
                'requirements-inactive-forbidden',
            ),
            'event_safety_actor_not_active',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $foreign,
                $this->configuration(),
                0,
                'requirements-cross-tenant-actor',
            ),
            'event_safety_actor_not_active',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $foreignEventId,
                $owner,
                $this->configuration(),
                0,
                'requirements-cross-tenant-event',
            ),
            'event_safety_event_not_found',
        );
        $this->assertReason(
            fn () => $service->saveDraft(
                $recurringId,
                $owner,
                $this->configuration(),
                0,
                'requirements-recurring-template',
            ),
            'event_safety_concrete_event_required',
        );

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => false], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->assertReason(
            fn () => $service->saveDraft(
                $eventId,
                $owner,
                $this->configuration(),
                0,
                'requirements-feature-disabled',
            ),
            'event_safety_feature_disabled',
        );
    }

    /** @return array<string,mixed> */
    private function configuration(): array
    {
        return [
            'minimum_age' => null,
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => true,
            'code_of_conduct_text' => 'Respect the event conduct policy.',
            'code_of_conduct_text_version' => 'v1',
        ];
    }

    private function user(array $overrides = [], int $tenantId = 2): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(
        int $ownerId,
        array $overrides = [],
        int $tenantId = 2,
        bool $recurring = false,
    ): int {
        $start = CarbonImmutable::now('UTC')->addMonths(2)->startOfHour();

        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'title' => 'Safety requirement fixture',
            'description' => 'Safety requirement fixture.',
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
            'is_recurring_template' => $recurring,
            'occurrence_key' => 'safety-requirements:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
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
}
