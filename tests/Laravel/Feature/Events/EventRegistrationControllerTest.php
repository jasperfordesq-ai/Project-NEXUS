<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Http\Controllers\Api\EventRegistrationController;
use App\Models\User;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventRegistrationControllerTest extends TestCase
{
    use DatabaseTransactions;

    private EventRegistrationService $registrations;
    private EventWaitlistService $waitlist;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('event_waitlist.envelope.active_key_version', 'controller-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.previous_keys', []);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->registrations = new EventRegistrationService();
        $this->waitlist = new EventWaitlistService($this->registrations);
    }

    public static function canonicalRoutes(): array
    {
        return [
            'relationship' => ['GET', 'api/v2/events/{id}/relationship'],
            'confirm' => ['POST', 'api/v2/events/{id}/registration/confirm'],
            'withdraw' => ['POST', 'api/v2/events/{id}/registration/withdraw'],
            'join waitlist' => ['POST', 'api/v2/events/{id}/registration/waitlist'],
            'leave waitlist' => ['POST', 'api/v2/events/{id}/registration/waitlist/leave'],
            'accept offer' => ['POST', 'api/v2/events/{id}/registration/waitlist/accept'],
            'people' => ['GET', 'api/v2/events/{id}/people'],
            'people export' => ['GET', 'api/v2/events/{id}/people/export.csv'],
            'people bulk' => ['POST', 'api/v2/events/{id}/people/bulk'],
            'people history' => ['GET', 'api/v2/events/{id}/people/{userId}/history'],
            'people attendance' => ['POST', 'api/v2/events/{id}/people/{userId}/attendance'],
            'approve' => ['POST', 'api/v2/events/{id}/people/{userId}/approve'],
            'reject' => ['POST', 'api/v2/events/{id}/people/{userId}/reject'],
            'cancel' => ['POST', 'api/v2/events/{id}/people/{userId}/cancel'],
        ];
    }

    /** @dataProvider canonicalRoutes */
    public function test_every_canonical_route_is_authenticated_and_events_entitled(
        string $method,
        string $uri,
    ): void {
        $route = $this->findRoute($method, $uri);

        self::assertNotNull($route, "Missing {$method} {$uri}");
        self::assertSame(EventRegistrationController::class, explode('@', $route->getActionName())[0]);
        self::assertContains('auth:sanctum', $route->middleware());
        self::assertContains('feature:events', $route->middleware());
    }

    public function test_relationship_confirm_withdraw_and_replay_are_redacted_and_idempotent(): void
    {
        $organizer = $this->member('Registration Organizer');
        $member = $this->member('Registration Member', [
            'email' => 'private-registration@example.test',
            'phone' => '+1 555 999 0000',
        ]);
        $eventId = $this->event((int) $organizer->id, 2);
        Sanctum::actingAs($member, ['*']);

        $this->apiGet("/v2/events/{$eventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.registration.state', null)
            ->assertJsonPath('data.privacy.sensitive_fields_redacted', true)
            ->assertJsonPath('data.actions.idempotency_key_required', true)
            ->assertJsonPath('data.actions.confirm', true)
            ->assertJsonPath('data.actions.join_waitlist', false);

        $unlimitedEventId = $this->event((int) $organizer->id, null);
        $this->apiGet("/v2/events/{$unlimitedEventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.actions.confirm', true)
            ->assertJsonPath('data.actions.join_waitlist', false);

        $confirmed = $this->apiPost(
            "/v2/events/{$eventId}/registration/confirm",
            [],
            ['Idempotency-Key' => 'controller-confirm-1'],
        );
        $confirmed->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'confirmed')
            ->assertJsonPath('data.mutation.changed', true)
            ->assertJsonPath('data.mutation.idempotent_replay', false);
        self::assertStringNotContainsString('private-registration@example.test', $confirmed->getContent());
        self::assertStringNotContainsString('+1 555 999 0000', $confirmed->getContent());

        $this->apiPost(
            "/v2/events/{$eventId}/registration/confirm",
            [],
            ['Idempotency-Key' => 'controller-confirm-1'],
        )->assertOk()
            ->assertJsonPath('data.mutation.changed', false)
            ->assertJsonPath('data.mutation.idempotent_replay', true);

        $this->apiPost("/v2/events/{$eventId}/registration/withdraw")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_IDEMPOTENCY_REQUIRED')
            ->assertJsonPath('errors.0.message', __('event_registration.idempotency_required'));
        $this->apiPost(
            "/v2/events/{$eventId}/registration/withdraw",
            ['idempotency_key' => 'body-key'],
            ['Idempotency-Key' => 'different-header-key'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_IDEMPOTENCY_INVALID');
        $this->apiPost(
            "/v2/events/{$eventId}/registration/withdraw",
            ['reason' => str_repeat('x', 4001)],
            ['Idempotency-Key' => 'reason-too-long'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_VALIDATION_FAILED');

        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $member->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost(
            "/v2/events/{$eventId}/registration/withdraw",
            ['reason' => 'Plans changed'],
            ['Idempotency-Key' => 'controller-withdraw-1'],
        )->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'cancelled')
            ->assertJsonPath('data.mutation.released_capacity', true);
        self::assertSame('cancelled', DB::table('event_reminders')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->value('status'));
        self::assertSame(1, DB::table('event_registration_history')
            ->where('event_id', $eventId)
            ->where('action', 'cancelled')
            ->count());
    }

    public function test_tenant_registration_and_waitlist_policies_hide_and_block_canonical_actions(): void
    {
        $organizer = $this->member('Policy Organizer');
        $member = $this->member('Policy Member');
        $eventId = $this->event((int) $organizer->id, 1);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode([
                'events' => [
                    'registration_enabled' => false,
                    'waitlist_enabled' => false,
                ],
            ]),
        ]);
        Sanctum::actingAs($member, ['*']);

        $this->apiGet("/v2/events/{$eventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.actions.confirm', false)
            ->assertJsonPath('data.actions.join_waitlist', false);

        $this->apiPost(
            "/v2/events/{$eventId}/registration/confirm",
            [],
            ['Idempotency-Key' => 'tenant-registration-disabled'],
        )->assertForbidden()->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_DISABLED');

        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist",
            [],
            ['Idempotency-Key' => 'tenant-waitlist-disabled'],
        )->assertForbidden()->assertJsonPath('errors.0.code', 'EVENT_WAITLIST_DISABLED');
    }

    public function test_relationship_capacity_reserves_live_offers_and_deduplicates_corrupt_overlap(): void
    {
        $organizer = $this->member('Capacity Read Organizer');
        $holder = $this->member('Capacity Read Holder');
        $offered = $this->member('Capacity Read Offered');
        $viewer = $this->member('Capacity Read Viewer');
        $now = now();
        $reservedEventId = $this->event((int) $organizer->id, 2);
        $overlapEventId = $this->event((int) $organizer->id, 2);

        foreach ([$reservedEventId, $overlapEventId] as $eventId) {
            DB::table('event_registrations')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $holder->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'confirmed',
                'registration_version' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $holder->id,
                'confirmed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        foreach ([
            [$reservedEventId, $offered->id, 1],
            [$overlapEventId, $holder->id, 2],
        ] as [$eventId, $userId, $sequence]) {
            DB::table('event_waitlist_entries')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'capacity_pool_key' => 'event',
                'queue_state' => 'offered',
                'queue_version' => 2,
                'queue_sequence' => $sequence,
                'state_changed_at' => $now,
                'state_changed_by' => $organizer->id,
                'offered_at' => $now,
                'offer_expires_at' => $now->copy()->addHour(),
                'offer_token_hash' => hash('sha256', "capacity-read-{$eventId}"),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        Sanctum::actingAs($viewer, ['*']);
        $this->apiGet("/v2/events/{$reservedEventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.capacity.confirmed', 1)
            ->assertJsonPath('data.capacity.remaining', 0)
            ->assertJsonPath('data.capacity.is_full', true)
            ->assertJsonPath('data.actions.confirm', false)
            ->assertJsonPath('data.actions.join_waitlist', true);
        $this->apiGet("/v2/events/{$overlapEventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.capacity.confirmed', 1)
            ->assertJsonPath('data.capacity.remaining', 1)
            ->assertJsonPath('data.capacity.is_full', false)
            ->assertJsonPath('data.actions.confirm', true);
    }

    public function test_full_event_waitlist_join_leave_and_single_use_offer_acceptance(): void
    {
        $organizer = $this->member('Waitlist Organizer');
        $holder = $this->member('Capacity Holder');
        $waiter = $this->member('Waitlist Member', [
            'notification_preferences' => [
                'email_events' => false,
            ],
        ]);
        self::assertFalse((bool) ($waiter->notification_preferences['email_events'] ?? true));
        $eventId = $this->event((int) $organizer->id, 1);
        $this->registrations->confirm(
            $eventId,
            (int) $holder->id,
            $holder,
            'controller-fill-capacity',
        );
        Sanctum::actingAs($waiter, ['*']);

        $this->apiGet("/v2/events/{$eventId}/relationship")
            ->assertOk()
            ->assertJsonPath('data.actions.confirm', false)
            ->assertJsonPath('data.actions.join_waitlist', true);

        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist",
            [],
            ['Idempotency-Key' => 'controller-waitlist-join'],
        )->assertCreated()
            ->assertJsonPath('data.relationship.waitlist.state', 'waiting')
            ->assertJsonPath('data.relationship.waitlist.position', 1);
        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist/leave",
            ['reason' => 'No longer needed'],
            ['Idempotency-Key' => 'controller-waitlist-leave'],
        )->assertOk()
            ->assertJsonPath('data.relationship.waitlist.state', 'cancelled');
        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist",
            [],
            ['Idempotency-Key' => 'controller-waitlist-rejoin'],
        )->assertCreated()
            ->assertJsonPath('data.relationship.waitlist.state', 'waiting');

        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $this->waitlist->offerNext(
            $eventId,
            $organizer,
            'controller-offer-place',
        );
        self::assertNotNull($offer?->offerToken);

        try {
            $this->waitlist->acceptActiveOffer(
                $eventId,
                (int) $waiter->id,
                $organizer,
                'organizer-cannot-bypass-offer-token',
            );
            self::fail('A different actor accepted the member offer without a token.');
        } catch (\App\Exceptions\EventWaitlistException $exception) {
            self::assertSame(
                'event_waitlist_offer_self_acceptance_required',
                $exception->reasonCode,
            );
        }

        $accepted = $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist/accept",
            [],
            ['Idempotency-Key' => 'controller-accept-offer'],
        );
        $accepted->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'confirmed')
            ->assertJsonPath('data.relationship.waitlist.state', 'accepted');
        self::assertStringNotContainsString((string) $offer->offerToken, $accepted->getContent());
        self::assertSame('erased', DB::table('event_waitlist_offer_envelopes')
            ->where('waitlist_entry_id', $offer->entry->id)
            ->value('status'));
        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist/accept",
            [],
            ['Idempotency-Key' => 'controller-accept-offer'],
        )->assertOk()
            ->assertJsonPath('data.mutation.changed', false)
            ->assertJsonPath('data.mutation.idempotent_replay', true);

        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist/accept",
            ['token' => str_repeat('t', 513)],
            ['Idempotency-Key' => 'controller-token-too-long'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_WAITLIST_OFFER_TOKEN_INVALID');
        $this->apiPost(
            "/v2/events/{$eventId}/registration/waitlist/accept",
            ['token' => null],
            ['Idempotency-Key' => 'controller-null-token'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_WAITLIST_OFFER_TOKEN_INVALID');
    }

    public function test_people_and_manager_transitions_follow_policy_and_tenant_scope(): void
    {
        $organizer = $this->member('People Organizer');
        $outsider = $this->member('People Outsider');
        $approve = $this->member('Approve Subject');
        $reject = $this->member('Reject Subject');
        $cancel = $this->member('Cancel Subject');
        $invalidReason = $this->member('Invalid Reason Subject');
        $eventId = $this->event((int) $organizer->id, 10);
        foreach ([$approve, $reject, $cancel, $invalidReason] as $index => $subject) {
            $this->registrations->transition(
                $eventId,
                (int) $subject->id,
                EventCapacityRegistrationState::Pending,
                $organizer,
                "controller-seed-pending-{$index}",
            );
        }

        Sanctum::actingAs($outsider, ['*']);
        $this->apiGet("/v2/events/{$eventId}/relationship")->assertOk();
        $this->apiGet("/v2/events/{$eventId}/people")
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_FORBIDDEN');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$approve->id}/approve",
            [],
            ['Idempotency-Key' => 'outsider-approve'],
        )->assertForbidden();

        Sanctum::actingAs($organizer, ['*']);
        $this->apiGet("/v2/events/{$eventId}/people")
            ->assertOk()
            ->assertJsonPath('meta.capabilities.view_roster', true)
            ->assertJsonPath('meta.capabilities.view_waitlist', true)
            ->assertJsonPath('meta.capabilities.manage_registration', true)
            ->assertJsonPath('meta.sensitive_fields_redacted', true);
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$approve->id}/approve",
            [],
            ['Idempotency-Key' => 'organizer-approve'],
        )->assertOk()->assertJsonPath('data.relationship.registration.state', 'confirmed');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$reject->id}/reject",
            [],
            ['Idempotency-Key' => 'organizer-reject-missing-reason'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_REASON_REQUIRED')
            ->assertJsonPath('errors.0.field', 'reason');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$reject->id}/reject",
            ['reason' => 'Capacity review'],
            ['Idempotency-Key' => 'organizer-reject'],
        )->assertOk()->assertJsonPath('data.relationship.registration.state', 'declined');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$reject->id}/approve",
            [],
            ['Idempotency-Key' => 'manager-cannot-reenrol-declined'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_TRANSITION_INVALID');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$cancel->id}/cancel",
            [],
            ['Idempotency-Key' => 'organizer-cancel-missing-reason'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_REASON_REQUIRED');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$cancel->id}/cancel",
            ['reason' => 'Event requirements changed'],
            ['Idempotency-Key' => 'organizer-cancel'],
        )->assertOk()->assertJsonPath('data.relationship.registration.state', 'cancelled');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$cancel->id}/approve",
            [],
            ['Idempotency-Key' => 'manager-cannot-reenrol-cancelled'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_TRANSITION_INVALID');
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$invalidReason->id}/cancel",
            ['reason' => ['invalid']],
            ['Idempotency-Key' => 'manager-invalid-reason'],
        )->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_VALIDATION_FAILED');

        $foreignTenantId = $this->tenant();
        $foreignOrganizer = $this->member('Foreign Organizer', [], $foreignTenantId);
        $foreignEventId = $this->event(
            (int) $foreignOrganizer->id,
            5,
            $foreignTenantId,
        );
        $this->apiGet("/v2/events/{$foreignEventId}/relationship")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'EVENT_NOT_FOUND');
    }

    public function test_non_registrable_events_never_advertise_entry_actions(): void
    {
        $organizer = $this->member('Availability Organizer');
        $member = $this->member('Availability Member');
        $cancelled = $this->event((int) $organizer->id, 2);
        $past = $this->event((int) $organizer->id, 2);
        $template = $this->event((int) $organizer->id, 2);
        DB::table('events')->where('id', $cancelled)->update([
            'operational_status' => 'cancelled',
            'status' => 'cancelled',
        ]);
        DB::table('events')->where('id', $past)->update([
            'start_time' => now()->subHours(2),
            'end_time' => now()->subHour(),
        ]);
        DB::table('events')->where('id', $template)->update([
            'is_recurring_template' => 1,
            'occurrence_key' => null,
        ]);
        Sanctum::actingAs($member, ['*']);

        foreach ([$cancelled, $past, $template] as $eventId) {
            $this->apiGet("/v2/events/{$eventId}/relationship")
                ->assertOk()
                ->assertJsonPath('data.actions.registrable', false)
                ->assertJsonPath('data.actions.confirm', false)
                ->assertJsonPath('data.actions.join_waitlist', false)
                ->assertJsonPath('data.actions.accept_offer', false);
        }
    }

    public function test_self_exit_remains_available_after_audience_revocation_or_unpublishing(): void
    {
        $organizer = $this->member('Exit Organizer');
        $registered = $this->member('Revoked Registered Member');
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $organizer->id,
            'name' => 'Private exit group',
            'slug' => 'private-exit-' . bin2hex(random_bytes(6)),
            'description' => 'Private audience exit fixture.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $registered->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $privateEvent = $this->event((int) $organizer->id, 3);
        DB::table('events')->where('id', $privateEvent)->update(['group_id' => $groupId]);
        Sanctum::actingAs($registered, ['*']);
        $this->apiPost(
            "/v2/events/{$privateEvent}/registration/confirm",
            [],
            ['Idempotency-Key' => 'exit-private-confirm'],
        )->assertOk();
        DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('user_id', $registered->id)
            ->delete();
        $this->apiPost(
            "/v2/events/{$privateEvent}/registration/withdraw",
            ['reason' => 'I no longer have access'],
            ['Idempotency-Key' => 'exit-private-withdraw'],
        )->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'cancelled');

        $holder = $this->member('Exit Capacity Holder');
        $waiter = $this->member('Unpublished Waiter');
        $unpublishedEvent = $this->event((int) $organizer->id, 1);
        $this->registrations->confirm(
            $unpublishedEvent,
            (int) $holder->id,
            $holder,
            'exit-fill-capacity',
        );
        Sanctum::actingAs($waiter, ['*']);
        $this->apiPost(
            "/v2/events/{$unpublishedEvent}/registration/waitlist",
            [],
            ['Idempotency-Key' => 'exit-waitlist-join'],
        )->assertCreated();
        DB::table('events')->where('id', $unpublishedEvent)->update([
            'publication_status' => 'draft',
            'status' => 'draft',
        ]);
        $this->apiPost(
            "/v2/events/{$unpublishedEvent}/registration/waitlist/leave",
            ['reason' => 'Event is no longer visible'],
            ['Idempotency-Key' => 'exit-waitlist-leave'],
        )->assertOk()
            ->assertJsonPath('data.relationship.waitlist.state', 'cancelled')
            ->assertJsonPath('data.relationship.actions.registrable', false);
    }

    public function test_feature_gate_blocks_controller_before_registration_lookup(): void
    {
        $member = $this->member('Feature Gated Member');
        Sanctum::actingAs($member, ['*']);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => false], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->apiGet('/v2/events/999999999/relationship')
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    private function findRoute(string $method, string $uri): ?LaravelRoute
    {
        foreach (Route::getRoutes() as $route) {
            if ($route->uri() === $uri && in_array($method, $route->methods(), true)) {
                return $route;
            }
        }

        return null;
    }

    /** @param array<string,mixed> $overrides */
    private function member(
        string $name,
        array $overrides = [],
        ?int $tenantId = null,
    ): User {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'name' => $name,
            'first_name' => $name,
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(int $organizerId, ?int $capacity, ?int $tenantId = null): int
    {
        $start = now()->addWeek();
        $tenantId ??= $this->testTenantId;

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organizerId,
            'title' => 'Canonical registration API fixture',
            'description' => 'Controller integration fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => "controller:{$tenantId}:" . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => $capacity,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function tenant(): int
    {
        $suffix = bin2hex(random_bytes(6));

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Foreign registration tenant',
            'slug' => 'foreign-registration-' . $suffix,
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
