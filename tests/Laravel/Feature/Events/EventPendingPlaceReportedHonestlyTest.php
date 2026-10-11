<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationService;
use App\Services\GamificationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * Under the organiser's manual approval a member's "I'm going" becomes a
 * pending request, not a place. Two member paths reported it as a place
 * anyway: accepting an invitation answered `participation.status:
 * confirmed`, and the legacy RSVP answered `status: going` and paid the
 * attend_event XP for a request the organiser might still refuse.
 *
 * Both now report `pending`, the XP waits for a confirmed place, and the
 * organiser's approval pays it (once).
 */
final class EventPendingPlaceReportedHonestlyTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_accepting_an_invitation_under_manual_approval_reports_pending(): void
    {
        $owner = $this->eventUser();
        $invitee = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $this->publishApproval($eventId, $owner, 'manual');
        $secret = $this->memberInvitation($eventId, $owner, $invitee, $start);

        $service = new EventInvitationService();
        $accepted = $service->accept($eventId, $secret, $invitee, 'pending-invite-accept');
        $replay = $service->accept($eventId, $secret, $invitee, 'pending-invite-accept');

        self::assertSame('pending', $this->state($eventId, $invitee));
        self::assertSame(
            'pending',
            $accepted['participation']['status'],
            'BAD OUTCOME: the invitee was told the place is confirmed while it awaits the organiser.',
        );
        self::assertSame('pending', $replay['participation']['status']);
    }

    public function test_control_accepting_an_invitation_with_automatic_approval_reports_confirmed(): void
    {
        $owner = $this->eventUser();
        $invitee = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $this->publishApproval($eventId, $owner, 'auto');
        $secret = $this->memberInvitation($eventId, $owner, $invitee, $start);

        $accepted = (new EventInvitationService())->accept($eventId, $secret, $invitee, 'auto-invite-accept');

        self::assertSame('confirmed', $this->state($eventId, $invitee));
        self::assertSame('confirmed', $accepted['participation']['status']);
    }

    public function test_legacy_going_rsvp_under_manual_approval_reports_pending_and_pays_no_xp(): void
    {
        $owner = $this->eventUser(['xp' => 0]);
        $member = $this->eventUser(['xp' => 0]);
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $this->publishApproval($eventId, $owner, 'manual');

        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'going'], ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'pending')
            ->assertJsonPath('data.status', 'pending');

        self::assertSame('pending', $this->state($eventId, $member));
        self::assertSame(0, $this->attendXpClaims($member, $eventId), 'BAD OUTCOME: attend_event XP paid for a request the organiser has not approved.');
    }

    public function test_organiser_approval_pays_the_attend_xp_once(): void
    {
        $owner = $this->eventUser(['xp' => 0]);
        $member = $this->eventUser(['xp' => 0]);
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $this->publishApproval($eventId, $owner, 'manual');

        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'going'])->assertOk();
        self::assertSame(0, $this->attendXpClaims($member, $eventId));

        Sanctum::actingAs($owner, ['*']);
        $this->apiPost(
            "/v2/events/{$eventId}/people/{$member->id}/approve",
            [],
            ['Idempotency-Key' => 'pending-xp-approve'],
        )->assertOk()->assertJsonPath('data.relationship.registration.state', 'confirmed');
        // A later "going" RSVP on the now-confirmed place must not pay again.
        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'going'])->assertOk();

        self::assertSame('confirmed', $this->state($eventId, $member));
        self::assertSame(1, $this->attendXpClaims($member, $eventId), 'BAD OUTCOME: the approved place never earned the attend_event XP.');
        self::assertSame(
            GamificationService::XP_VALUES['attend_event'],
            (int) DB::table('users')->where('id', $member->id)->value('xp'),
        );
    }

    public function test_control_legacy_going_rsvp_with_automatic_approval_reports_going_and_pays_xp(): void
    {
        $owner = $this->eventUser(['xp' => 0]);
        $member = $this->eventUser(['xp' => 0]);
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $this->publishApproval($eventId, $owner, 'auto');

        Sanctum::actingAs($member, ['*']);
        $this->apiPost("/v2/events/{$eventId}/rsvp", ['status' => 'going'], ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'confirmed')
            ->assertJsonPath('data.status', 'going');

        self::assertSame(1, $this->attendXpClaims($member, $eventId));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function publishApproval(int $eventId, User $owner, string $approvalMode): void
    {
        $event = DB::table('events')->where('id', $eventId)->first(['occurrence_key', 'start_time']);
        DB::table('event_registration_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => $event->occurrence_key,
            'revision' => 1,
            'status' => 'published',
            'approval_mode' => $approvalMode,
            'event_starts_at_utc_snapshot' => $event->start_time,
            'event_timezone_snapshot' => 'UTC',
            'created_by' => $owner->id,
            'updated_by' => $owner->id,
            'published_by' => $owner->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function memberInvitation(int $eventId, User $owner, User $invitee, CarbonImmutable $start): string
    {
        $input = ['member_ids' => [(int) $invitee->id]];
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'audience',
            $input,
            'pending-invite-preview-' . bin2hex(random_bytes(4)),
        );
        $issued = (new EventInvitationService())->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            $input,
            1,
            'pending-invite-issue-' . bin2hex(random_bytes(4)),
            $start->subDay()->toIso8601String(),
        );

        return (string) $issued['invitations'][0]['secret'];
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }

    private function attendXpClaims(User $member, int $eventId): int
    {
        return DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('action', 'attend_event')
            ->where('source_reference', 'event:' . $eventId)
            ->count();
    }
}
