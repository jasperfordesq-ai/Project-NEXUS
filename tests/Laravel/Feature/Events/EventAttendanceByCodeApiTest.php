<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventCheckinCredentialService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * POST /api/v2/events/{id}/attendance/code — the 707th route.
 *
 * 🔴 Why it exists. The Blade accessible frontend records attendance from a scanned
 * signed credential IN-PROCESS
 * (`GovukAlpha\Concerns\EventOfflineCheckinParity::eventsOfflineCheckinCode`),
 * calling three services directly. It was the one accessible-frontend action with
 * no HTTP equivalent, so web-uk could not reach it — which is why route parity sat
 * at 706 of 707 and why Blade could not be retired.
 *
 * These tests pin the behaviours that make it equivalent to Blade rather than merely
 * similar, because "similar" is what makes a retirement unsafe:
 *
 *  - a scan alone must not mutate anything (confirmation required);
 *  - an unreadable credential and a credential for somebody the actor cannot see
 *    give the SAME answer, so the endpoint cannot be used to probe who is registered;
 *  - undo requires a reason;
 *  - it reads the attendance version itself, because a scanner cannot know it.
 */
final class EventAttendanceByCodeApiTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $ownerId): int
    {
        $start = CarbonImmutable::now('UTC')->subMinutes(5);
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Attendance-by-code fixture',
            'description' => 'Attendance-by-code fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(4),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => false,
            'lifecycle_version' => 0,
            'checkin_manifest_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('events')->where('id', $eventId)->update([
            'occurrence_key' => "occurrence:{$eventId}",
        ]);

        return $eventId;
    }

    private function registration(int $eventId, int $userId): int
    {
        return (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $userId,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function rsvp(int $eventId, int $userId): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array{0: User, 1: User, 2: int, 3: string} organiser, attendee, eventId, credential */
    private function fixture(): array
    {
        $organiser = $this->user();
        $attendee = $this->user();
        $eventId = $this->event((int) $organiser->id);
        $registrationId = $this->registration($eventId, (int) $attendee->id);
        $this->rsvp($eventId, (int) $attendee->id);

        $issued = (new EventCheckinCredentialService())->issue(
            $eventId,
            $registrationId,
            (int) $organiser->id,
            (string) Str::uuid(),
        );

        return [$organiser, $attendee, $eventId, (string) $issued->secret];
    }

    private function postCode(int $eventId, array $payload)
    {
        return $this->apiPost("/v2/events/{$eventId}/attendance/code", $payload);
    }

    public function test_a_scanned_credential_marks_the_member_present(): void
    {
        [$organiser, $attendee, $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            'idempotency_key' => (string) Str::uuid(),
        ]);

        $response->assertStatus(200);
        $this->assertSame((int) $attendee->id, $response->json('data.member.id'));
        $this->assertNotNull($response->json('data.mutation'));
    }

    public function test_it_requires_the_caller_to_supply_an_idempotency_key(): void
    {
        // 🔴 A DELIBERATE IMPROVEMENT ON BLADE, not an accidental divergence.
        // Blade generates a fresh uuid server-side whenever the field is absent
        // (EventOfflineCheckinParity.php: `?: (string) Str::uuid()`), which means its
        // idempotency key can never match a previous submission — so a double-tapped
        // scan in Blade is NOT protected by it. Requiring the caller to send a stable
        // key is what actually makes a replay safe, and it matches every other
        // mutating endpoint on this controller.
        [$organiser, , $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
        ]);

        $response->assertStatus(422);
        $this->assertSame(
            'EVENT_REGISTRATION_IDEMPOTENCY_REQUIRED',
            $response->json('errors.0.code'),
        );
    }

    public function test_it_reads_the_attendance_version_itself(): void
    {
        // 🔴 The one deliberate difference from the roster-pick endpoint, which
        // requires expected_version from the caller. A scanner holds a signed code,
        // not a roster row, and has no way to know the version — so demanding it
        // would make the endpoint unusable for the case it exists for. Blade made
        // the same choice.
        [$organiser, , $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            'idempotency_key' => (string) Str::uuid(),
        ]);

        $response->assertStatus(200);
    }

    public function test_a_scan_without_confirmation_changes_nothing(): void
    {
        // 🔴 A link preview or crawler fetching the URL must never mark somebody
        // present. Blade requires confirmation === '1' for exactly this reason.
        [$organiser, $attendee, $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
        $this->assertSame(0, DB::table('event_attendance')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $attendee->id)
            ->count());
    }

    public function test_it_rejects_a_credential_without_the_signed_prefix(): void
    {
        [$organiser, , $eventId] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => 'not-a-signed-credential',
            'confirmation' => '1',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
    }

    public function test_it_rejects_an_over_long_credential_without_verifying_it(): void
    {
        // Bounded at 1024 characters like Blade, so an enormous body cannot be fed
        // into the signature verifier.
        [$organiser, , $eventId] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => 'nqx2_' . str_repeat('a', 1100),
            'confirmation' => '1',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
    }

    public function test_undo_requires_a_reason(): void
    {
        // Reversing an attendance record is a correction to a register, and a
        // correction with no stated reason is not auditable.
        [$organiser, , $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'undo',
            'credential' => $credential,
            'confirmation' => '1',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
    }

    public function test_it_rejects_an_unknown_action(): void
    {
        [$organiser, , $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'teleport',
            'credential' => $credential,
            'confirmation' => '1',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
    }

    public function test_it_rejects_unexpected_keys(): void
    {
        // assertOnlyKeys, matching every other endpoint on this controller: a typo'd
        // field must fail loudly rather than being silently ignored.
        [$organiser, , $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            'expected_versionn' => 0,
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_VALIDATION_FAILED');
    }

    public function test_a_member_without_roster_permission_is_refused(): void
    {
        // 🔴 ASSERTS 403 AND THE EXACT CODE. This previously accepted any of
        // [401, 403, 404, 422], which was wrong for a specific reason: 422 is what a
        // VALIDATION failure returns, so a test about authorisation could have been
        // satisfied by a refusal that had nothing to do with who the caller was.
        //
        // 🔴 What this test does NOT prove, established by experiment rather than
        // assumed. Disabling the controller's check in attendanceContext()
        // (viewRoster AND manageAttendance) leaves this test PASSING — because
        // EventAttendanceService::transition independently re-checks
        // manageAttendance against a FRESHLY RE-READ actor and throws
        // event_attendance_authorization_denied, which lands in the same 403 arm.
        //
        // That is genuine defence in depth, and the re-read also defeats a stale-role
        // attack. So this test pins the observable contract — an outsider is refused
        // with 403 EVENT_REGISTRATION_FORBIDDEN — and deliberately does not care
        // which of the two layers refused. Removing ONE layer is still a refusal, by
        // design; removing BOTH is what this catches.
        [, , $eventId, $credential] = $this->fixture();
        $outsider = $this->user();
        Sanctum::actingAs($outsider, ['*']);

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            // Supplied deliberately: without it the request could fail validation
            // for a MISSING KEY and produce a refusal that says nothing about
            // authorisation. The request must be otherwise valid so that 403 can
            // only mean "refused because of who you are".
            'idempotency_key' => (string) Str::uuid(),
        ]);

        $response->assertStatus(403);
        $this->assertSame(
            'EVENT_REGISTRATION_FORBIDDEN',
            $response->json('errors.0.code'),
        );
    }

    public function test_it_requires_authentication(): void
    {
        [, , $eventId, $credential] = $this->fixture();

        $response = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
        ]);

        $response->assertStatus(401);
    }

    public function test_a_credential_for_another_event_is_refused(): void
    {
        // 🔴 A signed credential is bound to its event and occurrence. Accepting one
        // across events would let a pass for a public event mark someone present at
        // a private one.
        [$organiser, , , $credential] = $this->fixture();
        $otherEventId = $this->event((int) $organiser->id);
        Sanctum::actingAs($organiser, ['*']);

        $response = $this->postCode($otherEventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
        ]);

        // A DIFFERENT code from the validation failures above: the request was
        // well-formed, and the credential simply does not belong to this event. Both
        // are 422, which is why asserting the status alone would not have
        // distinguished them.
        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_CHECKIN_CODE_INVALID');
    }

    public function test_replaying_the_same_idempotency_key_does_not_double_record(): void
    {
        [$organiser, $attendee, $eventId, $credential] = $this->fixture();
        Sanctum::actingAs($organiser, ['*']);
        $key = (string) Str::uuid();

        $first = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            'idempotency_key' => $key,
        ]);
        $first->assertStatus(200);

        $second = $this->postCode($eventId, [
            'action' => 'check_in',
            'credential' => $credential,
            'confirmation' => '1',
            'idempotency_key' => $key,
        ]);

        // 🔴 EXACTLY ONE ROW — the safety property that actually matters, and the one
        // the old assertion could not establish. `assertLessThanOrEqual(1, …)` is
        // satisfied by ZERO rows, so it passed whether the attendance was recorded
        // once or never recorded at all.
        $this->assertSame(1, DB::table('event_attendance')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $attendee->id)
            ->count());

        // 🔴 PINNED TO WHAT IT ACTUALLY DOES, WHICH IS NOT WHAT IT SHOULD DO.
        //
        // The old `assertContains($status, [200, 409, 422])` accepted three different
        // behaviours, so it could not tell success from refusal — and it was hiding a
        // real defect, which is exactly why a multi-status accept is not a test.
        //
        // Measured behaviour: an identical retry is REFUSED with 409
        // EVENT_REGISTRATION_IDEMPOTENCY_CONFLICT — "this idempotency key was already
        // used for a different request" — even though the request is byte-identical.
        // The cause is one layer down: `EventAttendanceService::transition()` threads
        // the key into `EventRegistrationService`, whose replay check compares
        // `max(0, registration_version - 1)` against an expected version derived from
        // CURRENT state. After the first call advances that version, a retry can never
        // match.
        //
        // 🔴 Why this matters to a real person: a scanner that retries after a network
        // timeout — the precise case an idempotency key exists for — is told the
        // check-in failed when it succeeded. The register is correct; the volunteer
        // holding the phone is misinformed and may check the person in again by hand.
        //
        // It is pinned rather than fixed because the fix belongs in the
        // attendance→registration version threading, which the LIVE roster endpoints
        // also use. A speculative change there could break production check-in, so it
        // needs its own change with its own tests. When that lands, this assertion
        // must be flipped to expect 200 and a replayed result.
        $second->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_IDEMPOTENCY_CONFLICT');

        // Either way, exactly ONE action was recorded — the refusal did not write a
        // second activity row. Counted by event and person rather than by the key,
        // because `event_attendance_activity.idempotency_key` does not store the raw
        // key the caller sent.
        $this->assertSame(1, DB::table('event_attendance_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $attendee->id)
            ->count());
    }
}
