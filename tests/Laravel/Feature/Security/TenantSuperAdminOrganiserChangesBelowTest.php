<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Models\User;
use App\Services\EventBroadcastService;
use App\Services\EventRegistrationService;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Mockery;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * A parent community's tenant super admin can now CHANGE the events of the
 * communities below it, and every change is recorded against its DELEGATE in
 * that community (owner, 12 Oct 2026: "Go with option 3").
 *
 * Before the delegate, each of these failed in the database: the event tables
 * record the actor with a composite key (<actor>, tenant_id) → users(id,
 * tenant_id), and the manager's own row is in the parent community. Each test
 * asserts the change happened AND names the delegate, never the manager's own
 * row. The last tests pin the same for the platform owner from another
 * community through the admin panel (register O-209).
 *
 * Fixture: parent 999 above the shared test community 2.
 */
final class TenantSuperAdminOrganiserChangesBelowTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    private const PARENT = 999;
    private const CHILD = 2;

    private User $manager;
    private User $organiser;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        Config::set('events.attendance_credit_mode', 'off');
        Config::set('events.notification_delivery.mode', 'direct');
        DB::table('tenant_settings')->where('tenant_id', self::CHILD)
            ->where('setting_key', 'events.notification_delivery_mode')->delete();

        $this->makeHomeTenantOversee(self::PARENT, self::CHILD);
        TenantContext::setById(self::CHILD);
        $this->manager = $this->user(self::PARENT, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
            'first_name' => 'Hub', 'last_name' => 'Manager',
        ]);
        $this->organiser = $this->user(self::CHILD, ['role' => 'member']);
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        Mockery::close();
        parent::tearDown();
    }

    public function test_cancel_an_event(): void
    {
        $eventId = $this->event();

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/cancel", ['reason' => 'Weather'], ['Idempotency-Key' => 'tsa-cancel-1']);

        $this->assertOk($response);
        self::assertSame('cancelled', DB::table('events')->where('id', $eventId)->value('operational_status'));
        $this->assertRecordedByDelegate('event_status_history', 'actor_user_id', ['event_id' => $eventId]);
    }

    public function test_cancel_an_event_that_has_a_scheduled_broadcast(): void
    {
        // The cancellation cascades into event_broadcasts (cancelled_by_user_id),
        // which failed in the database before the delegate (register O-209).
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));
        $this->scheduledBroadcast($eventId);

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/cancel", ['reason' => 'Venue lost'], ['Idempotency-Key' => 'tsa-cancel-2']);

        $this->assertOk($response);
        self::assertSame('cancelled', DB::table('events')->where('id', $eventId)->value('operational_status'));
        $this->assertRecordedByDelegate('event_broadcasts', 'cancelled_by_user_id', ['event_id' => $eventId]);
    }

    public function test_edit_an_event(): void
    {
        $eventId = $this->event();

        $response = $this->asManager('PUT', "/api/v2/events/{$eventId}", ['title' => 'Edited from above']);

        $this->assertOk($response);
        self::assertSame('Edited from above', DB::table('events')->where('id', $eventId)->value('title'));
    }

    public function test_approve_a_pending_registration(): void
    {
        Config::set('events.registration.default_capacity_pool_key', 'event');
        $eventId = $this->event();
        $member = $this->user(self::CHILD, ['role' => 'member']);
        app(EventRegistrationService::class)->transition(
            $eventId,
            (int) $member->id,
            EventCapacityRegistrationState::Pending,
            $this->organiser,
            'tsa-seed-pending-' . $eventId,
        );

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/people/{$member->id}/approve", [], ['Idempotency-Key' => 'tsa-approve-1']);

        $this->assertOk($response);
        self::assertSame('confirmed', DB::table('event_registrations')
            ->where('event_id', $eventId)->where('user_id', $member->id)->value('registration_state'));
        $this->assertRecordedByDelegate('event_registrations', 'state_changed_by', ['event_id' => $eventId, 'user_id' => $member->id]);
    }

    public function test_check_in_an_attendee(): void
    {
        $eventId = $this->event(now()->subMinutes(5), now()->addHours(2));
        $member = $this->user(self::CHILD, ['role' => 'member']);
        DB::table('event_rsvps')->insert([
            'tenant_id' => self::CHILD, 'event_id' => $eventId, 'user_id' => $member->id,
            'status' => 'going', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/attendees/{$member->id}/check-in", ['notes' => 'Front desk'], ['Idempotency-Key' => 'tsa-checkin-1']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_attendance', 'checked_in_by', ['event_id' => $eventId, 'user_id' => $member->id]);
    }

    public function test_create_a_broadcast(): void
    {
        $this->allowLocalContacts();
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/broadcasts", [
            'idempotency_key' => 'tsa-broadcast-1',
            'variant' => 'announcement',
            'segments' => ['registration_confirmed'],
            'channels' => ['in_app'],
            'body' => 'A message from the parent community.',
        ]);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_broadcasts', 'created_by_user_id', ['event_id' => $eventId]);
    }

    /**
     * E-106: the manager could draft a message below but every next step lives
     * under /api/v2/event-broadcasts/{id}, which the door did not admit, so it
     * could not open, send or cancel what it had just written.
     */
    public function test_open_send_and_cancel_a_broadcast(): void
    {
        $this->allowLocalContacts();
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));
        $created = $this->asManager('POST', "/api/v2/events/{$eventId}/broadcasts", [
            'idempotency_key' => 'tsa-broadcast-send-1',
            'variant' => 'announcement',
            'segments' => ['registration_confirmed'],
            'channels' => ['in_app'],
            'body' => 'Send this from the parent community.',
        ], ['Idempotency-Key' => 'tsa-broadcast-send-1']);
        $this->assertOk($created);
        $broadcastId = (int) $created->json('data.broadcast.id');
        self::assertGreaterThan(0, $broadcastId, (string) $created->getContent());

        $this->assertOk($this->asManager('GET', "/api/v2/event-broadcasts/{$broadcastId}"));

        $scheduled = $this->asManager('POST', "/api/v2/event-broadcasts/{$broadcastId}/schedule", [
            'idempotency_key' => 'tsa-broadcast-send-2',
            'expected_version' => 1,
            'scheduled_at' => now()->addDay()->toIso8601String(),
        ], ['Idempotency-Key' => 'tsa-broadcast-send-2']);
        $this->assertOk($scheduled);
        $this->assertRecordedByDelegate('event_broadcasts', 'scheduled_by_user_id', ['id' => $broadcastId]);

        $cancelled = $this->asManager('POST', "/api/v2/event-broadcasts/{$broadcastId}/cancel", [
            'idempotency_key' => 'tsa-broadcast-send-3',
            'expected_version' => 2,
            'reason' => 'organiser_cancelled',
        ], ['Idempotency-Key' => 'tsa-broadcast-send-3']);
        $this->assertOk($cancelled);
        $this->assertRecordedByDelegate('event_broadcasts', 'cancelled_by_user_id', ['id' => $broadcastId]);
    }

    /**
     * E-106: switching organiser messages off cancels the scheduled ones and
     * records who did it. From above, that was the manager's own row, which the
     * composite key refuses, so the whole settings save failed.
     */
    public function test_switch_messages_off_while_one_is_scheduled(): void
    {
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));
        $this->scheduledBroadcast($eventId);
        $current = $this->asManager('GET', '/api/v2/admin/config/events');
        $this->assertOk($current);

        $saved = $this->asManager('PUT', '/api/v2/admin/config/events', [
            'version' => (int) $current->json('data.version'),
            'reason' => 'Pause organiser messages.',
            'settings' => ['organizer_broadcasts_enabled' => false],
            'confirm_disruptive' => true,
        ]);

        $this->assertOk($saved);
        self::assertSame('cancelled', DB::table('event_broadcasts')->where('event_id', $eventId)->value('status'));
        $this->assertRecordedByDelegate('event_broadcasts', 'cancelled_by_user_id', ['event_id' => $eventId]);
    }

    public function test_create_a_ticket_type(): void
    {
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = $this->event($start, $start->addHours(3));

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/ticket-types", [
            'name' => 'Community ticket',
            'description' => 'Free entry.',
            'kind' => 'free',
            'unit_price_credits' => '0.00',
            'allocation_limit' => 10,
            'sales_opens_at' => CarbonImmutable::now('UTC')->subDay()->format('Y-m-d\TH:i:sP'),
            'sales_closes_at' => $start->subDay()->format('Y-m-d\TH:i:sP'),
            'per_member_limit' => 2,
            'eligibility_policy' => ['approved_member_required' => true, 'minimum_account_age_days' => 30, 'required_group_ids' => []],
            'refund_cutoff_at' => $start->subDays(2)->format('Y-m-d\TH:i:sP'),
            'organizer_cancel_refundable' => true,
        ], ['Idempotency-Key' => 'tsa-ticket-type-1']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_ticket_types', 'created_by', ['event_id' => $eventId]);
    }

    public function test_save_safety_requirements(): void
    {
        $eventId = $this->event();

        $response = $this->asManager('PUT', "/api/v2/events/{$eventId}/safety/requirements", [
            'minimum_age' => 18,
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], ['Idempotency-Key' => 'tsa-safety-1']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_safety_requirements', 'created_by_user_id', ['event_id' => $eventId]);
    }

    public function test_add_an_agenda_session(): void
    {
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = $this->event($start, $start->addHours(8), ['agenda_version' => 0]);

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/agenda/sessions", [
            'title' => 'Agenda session',
            'description' => 'A useful session.',
            'session_type' => 'session',
            'visibility' => 'public',
            'start_at' => $start->toIso8601String(),
            'end_at' => $start->addHour()->toIso8601String(),
            'timezone' => 'UTC',
            'track_name' => null,
            'room_name' => null,
            'speakers' => [],
        ], ['Idempotency-Key' => 'tsa-agenda-1']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_sessions', 'created_by', ['event_id' => $eventId]);
    }

    public function test_save_registration_settings(): void
    {
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();
        $eventId = $this->event($start, $start->addHours(3));

        $response = $this->asManager('PUT', "/api/v2/events/{$eventId}/registration-product/settings", [
            'expected_revision' => 0,
            'idempotency_key' => 'tsa-settings-1',
            'approval_mode' => 'manual',
            'opens_at' => $start->subDays(20)->format('Y-m-d\TH:i:sP'),
            'closes_at' => $start->format('Y-m-d\TH:i:sP'),
            'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
            'per_member_limit' => 1,
        ]);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_registration_settings', 'created_by', ['event_id' => $eventId]);
    }

    public function test_register_a_check_in_device(): void
    {
        $eventId = $this->event(now()->subHour(), now()->addHours(2), ['checkin_manifest_version' => 0]);

        $response = $this->asManager('POST', "/api/v2/events/{$eventId}/offline-checkin/devices", [
            'label' => 'Front desk',
        ], ['Idempotency-Key' => 'tsa-device-1', 'X-Events-Contract' => '2', 'X-Event-Checkin-Contract' => '1']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_checkin_devices', 'registered_by_user_id', ['event_id' => $eventId]);
    }

    public function test_view_analytics(): void
    {
        $eventId = $this->event(null, null, ['max_attendees' => 20]);

        $response = $this->asManager('GET', "/api/v2/events/{$eventId}/analytics");

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_analytics_access_audits', 'actor_user_id', ['event_id' => $eventId]);
    }

    public function test_cancel_through_the_admin_panel(): void
    {
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));
        $this->scheduledBroadcast($eventId);

        $response = $this->asManager('POST', "/api/v2/admin/events/{$eventId}/cancel", ['reason' => 'Venue closed']);

        $this->assertOk($response);
        self::assertSame('cancelled', DB::table('events')->where('id', $eventId)->value('operational_status'));
        $this->assertRecordedByDelegate('event_status_history', 'actor_user_id', ['event_id' => $eventId]);
    }

    public function test_the_platform_owner_from_another_community_cancels_through_the_admin_panel(): void
    {
        // Register O-209: this failed for the platform owner too.
        $this->manager = $this->user(self::PARENT, ['role' => 'admin', 'is_admin' => 1, 'is_super_admin' => 1]);
        $eventId = $this->event();
        $this->confirmed($eventId, $this->user(self::CHILD, ['role' => 'member']));
        $this->scheduledBroadcast($eventId);

        $response = $this->asManager('POST', "/api/v2/admin/events/{$eventId}/cancel", ['reason' => 'Venue closed']);

        $this->assertOk($response);
        $this->assertRecordedByDelegate('event_broadcasts', 'cancelled_by_user_id', ['event_id' => $eventId]);
    }

    public function test_a_member_of_the_community_still_acts_as_itself(): void
    {
        // Control: the community's own admin is never given a delegate.
        $admin = $this->user(self::CHILD, ['role' => 'admin', 'is_admin' => 1]);
        $eventId = $this->event();

        $response = $this->request('POST', "/api/v2/events/{$eventId}/cancel", $admin, ['reason' => 'Own admin'], ['Idempotency-Key' => 'own-cancel-1']);

        $this->assertOk($response);
        self::assertSame((int) $admin->id, (int) DB::table('event_status_history')->where('event_id', $eventId)->orderByDesc('id')->value('actor_user_id'));
        self::assertSame(0, DB::table('tenant_manager_delegates')->where('principal_user_id', $admin->id)->count());
    }

    // ------------------------------------------------------------- helpers

    private function assertOk(TestResponse $response): void
    {
        self::assertNotSame('TENANT_MISMATCH', $response->json('errors.0.code'), (string) $response->getContent());
        self::assertLessThan(300, $response->status(), (string) $response->getContent());
    }

    /** @param array<string,mixed> $where */
    private function assertRecordedByDelegate(string $table, string $column, array $where): void
    {
        $delegateId = (int) DB::table('tenant_manager_delegates')
            ->where('tenant_id', self::CHILD)
            ->where('principal_user_id', $this->manager->id)
            ->value('delegate_user_id');
        self::assertGreaterThan(0, $delegateId, 'The manager acted through a delegate in the child community.');

        $recorded = DB::table($table)->where($where)->whereNotNull($column)->orderByDesc('id')->value($column);
        self::assertSame($delegateId, (int) $recorded, "{$table}.{$column} names the delegate, never the manager's own row.");
        self::assertSame(self::CHILD, (int) DB::table('users')->where('id', $delegateId)->value('tenant_id'));
    }

    /**
     * @param array<string,mixed> $body
     * @param array<string,string> $headers
     */
    private function asManager(string $method, string $uri, array $body = [], array $headers = []): TestResponse
    {
        return $this->request($method, $uri, $this->manager, $body, $headers);
    }

    /**
     * @param array<string,mixed> $body
     * @param array<string,string> $headers
     */
    private function request(string $method, string $uri, User $actor, array $body = [], array $headers = []): TestResponse
    {
        $token = app(TokenService::class)->generateToken((int) $actor->id, (int) $actor->tenant_id, TwoFactorPolicy::claims('totp'));
        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        app('auth')->forgetGuards();

        $response = $this->withHeaders([
            ...$headers,
            'X-Tenant-ID' => (string) self::CHILD,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json($method, $uri, $body);
        TenantContext::setById(self::CHILD);

        return $response;
    }

    /** @param array<string,mixed> $extra */
    private function event(?\DateTimeInterface $start = null, ?\DateTimeInterface $end = null, array $extra = []): int
    {
        $start ??= now()->addDays(3);
        $end ??= \Carbon\Carbon::instance($start)->addHours(2);

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => self::CHILD,
            'user_id' => (int) $this->organiser->id,
            'title' => 'Organiser changes below',
            'description' => 'Organiser changes below fixture.',
            'occurrence_key' => 'ocb:' . self::CHILD . ':' . bin2hex(random_bytes(8)),
            'start_time' => $start,
            'end_time' => $end,
            'timezone' => 'UTC',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
            ...$extra,
        ]);
    }

    private function confirmed(int $eventId, User $member): void
    {
        DB::table('event_registrations')->insert([
            'tenant_id' => self::CHILD,
            'event_id' => $eventId,
            'user_id' => (int) $member->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function scheduledBroadcast(int $eventId): void
    {
        $this->allowLocalContacts();
        $service = app(EventBroadcastService::class);
        $draft = $service->createDraft($eventId, $this->organiser, 'announcement', ['registration_confirmed'], ['in_app'], 'Scheduled before the cancellation.', 'ocb-draft-' . $eventId);
        $id = (int) ($draft['broadcast']['id'] ?? $draft['id'] ?? 0);
        self::assertGreaterThan(0, $id, 'Fixture broadcast created: ' . json_encode($draft));
        $service->schedule($id, $this->organiser, 1, null, 'ocb-schedule-' . $eventId);
        self::assertSame('scheduled', DB::table('event_broadcasts')->where('id', $id)->value('status'));
    }

    private function allowLocalContacts(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceBroadcastAllowed')->zeroOrMoreTimes();
        App::instance(SafeguardingInteractionPolicy::class, $policy);
    }

    /** @param array<string,mixed> $attributes */
    private function user(int $tenantId, array $attributes): User
    {
        $current = TenantContext::currentId();
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'first_name' => 'Member',
            'last_name' => Str::title(Str::random(6)),
            ...$attributes,
        ]);
        if ($current !== null) {
            TenantContext::setById($current);
        }

        return $user->fresh() ?? $user;
    }
}
