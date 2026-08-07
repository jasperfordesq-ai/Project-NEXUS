<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A ward may AGREE, REFUSE, or WITHDRAW — not only agree.
 *
 * 🔴 `safeguarding_assignments` shipped with a single ward-facing column,
 * `consent_given_at`, so the only action available to the subject of a
 * safeguarding arrangement was to consent. There was no refusal, and no way to
 * change their mind afterwards — `revoked_at` is staff-only. A consent that
 * cannot be refused is not consent, and one that cannot be withdrawn fails the
 * ordinary expectation that withdrawal is as easy as giving.
 *
 * These tests cover the three responses, the transition rules, the fact that
 * only the ward may respond, the guardian's own view (which did not exist), and
 * that every change lands in an audit trail the database refuses to let anyone
 * rewrite.
 */
class GuardianArrangementResponseTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Seed a staff-proposed arrangement in its phase-5 home:
     * account_relationships, at tier 0, marked by proposed_by_user_id.
     * The old-name overrides (consent_given_at / consent_declined_at /
     * revoked_at) are translated so the test bodies read unchanged.
     *
     * @return array{0:User,1:User,2:int} [guardian, ward, assignmentId]
     */
    private function makeAssignment(array $overrides = []): array
    {
        $tenantId = $this->testTenantId;

        $guardian = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Grace', 'last_name' => 'Guardian', 'status' => 'active', 'is_approved' => true,
        ]);
        $ward = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Wendy', 'last_name' => 'Ward', 'status' => 'active', 'is_approved' => true,
        ]);
        $staff = User::factory()->forTenant($tenantId)->admin()->create();

        $status = 'pending';
        if (($overrides['revoked_at'] ?? null) !== null) {
            $status = 'revoked';
        } elseif (($overrides['consent_given_at'] ?? null) !== null) {
            $status = 'active';
        }

        $assignmentId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id'           => $tenantId,
            'parent_user_id'      => $guardian->id,
            'child_user_id'       => $ward->id,
            'relationship_type'   => 'guardian',
            'permissions'         => json_encode([
                'can_view_activity' => false, 'can_manage_listings' => false,
                'can_transact' => false, 'can_view_messages' => false,
                'tiers' => ['activity' => 'none', 'listings' => 'none', 'credits' => 'none'],
            ]),
            'status'              => $status,
            'proposed_by_user_id' => $staff->id,
            'staff_notes'         => $overrides['notes'] ?? null,
            'approved_at'         => $overrides['consent_given_at'] ?? null,
            'declined_at'         => $overrides['consent_declined_at'] ?? null,
            'withdrawn_at'        => $overrides['consent_withdrawn_at'] ?? null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        return [$guardian, $ward, $assignmentId];
    }

    /** The row, with the old column names aliased so assertions read unchanged. */
    private function row(int $id): object
    {
        $r = DB::table('account_relationships')->where('id', $id)->first();

        return (object) [
            'consent_given_at'     => $r->approved_at,
            'consent_declined_at'  => $r->declined_at,
            'consent_withdrawn_at' => $r->withdrawn_at,
            'ward_response_reason' => $r->response_reason,
            'status'               => $r->status,
        ];
    }

    /** @return list<object> */
    private function events(int $assignmentId): array
    {
        return DB::table('account_relationship_events')
            ->where('relationship_id', $assignmentId)
            ->orderBy('id')
            ->get()
            ->all();
    }

    public function test_a_ward_can_refuse_an_arrangement(): void
    {
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])
            ->assertStatus(200)
            ->assertJsonPath('data.state', 'declined');

        $row = $this->row($id);
        $this->assertNotNull($row->consent_declined_at, 'A refusal must be recorded.');
        $this->assertNull($row->consent_given_at);
    }

    public function test_a_reason_is_optional_and_stored_when_given(): void
    {
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        // 🔴 Never mandatory: requiring somebody to justify refusing a
        // safeguarding arrangement is pressure to consent.
        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])
            ->assertStatus(200);
        $this->assertNull($this->row($id)->ward_response_reason);

        [, $ward2, $id2] = $this->makeAssignment();
        Sanctum::actingAs($ward2);
        $this->apiPost('/v2/safeguarding/decline-guardian', [
            'assignment_id' => $id2,
            'reason' => '  I would rather not  ',
        ])->assertStatus(200);

        $this->assertSame('I would rather not', $this->row($id2)->ward_response_reason);
    }

    public function test_a_ward_can_withdraw_agreement_they_gave(): void
    {
        [, $ward, $id] = $this->makeAssignment(['consent_given_at' => now()]);
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/withdraw-guardian-consent', ['assignment_id' => $id])
            ->assertStatus(200)
            ->assertJsonPath('data.state', 'withdrawn');

        $row = $this->row($id);
        $this->assertNotNull($row->consent_withdrawn_at);
        // The row states one current position, never two at once.
        $this->assertNull($row->consent_given_at);
    }

    public function test_withdrawing_without_ever_agreeing_is_refused(): void
    {
        // You cannot withdraw something you never gave — allowing it would write
        // a misleading history row.
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/withdraw-guardian-consent', ['assignment_id' => $id])
            ->assertStatus(422);

        $this->assertNull($this->row($id)->consent_withdrawn_at);
    }

    public function test_a_ward_who_refused_may_change_their_mind(): void
    {
        [, $ward, $id] = $this->makeAssignment(['consent_declined_at' => now()]);
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $id])
            ->assertStatus(200)
            ->assertJsonPath('data.state', 'consented');

        $row = $this->row($id);
        $this->assertNotNull($row->consent_given_at);
        $this->assertNull($row->consent_declined_at, 'The earlier refusal must not linger alongside agreement.');
    }

    public function test_repeating_the_same_response_is_idempotent(): void
    {
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])->assertStatus(200);
        $first = $this->row($id)->consent_declined_at;

        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])
            ->assertStatus(200)
            ->assertJsonPath('data.already', true);

        $this->assertSame($first, $this->row($id)->consent_declined_at, 'A repeat must not move the timestamp.');
        // And must not add a second audit row for something that did not change.
        $this->assertCount(1, $this->events($id));
    }

    public function test_a_guardian_cannot_respond_on_the_wards_behalf(): void
    {
        // The entire value of the record is that it is the WARD's answer.
        [$guardian, , $id] = $this->makeAssignment();
        Sanctum::actingAs($guardian);

        foreach (['decline-guardian', 'consent-to-guardian'] as $path) {
            $this->apiPost("/v2/safeguarding/{$path}", ['assignment_id' => $id])->assertStatus(404);
        }

        $row = $this->row($id);
        $this->assertNull($row->consent_given_at);
        $this->assertNull($row->consent_declined_at);
    }

    public function test_a_stranger_cannot_respond(): void
    {
        [, , $id] = $this->makeAssignment();
        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($stranger);

        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])->assertStatus(404);
        $this->assertNull($this->row($id)->consent_declined_at);
    }

    public function test_a_revoked_arrangement_accepts_no_response(): void
    {
        [, $ward, $id] = $this->makeAssignment(['revoked_at' => now()]);
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])->assertStatus(404);
    }

    public function test_every_response_appends_an_attributed_audit_row(): void
    {
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $id])->assertStatus(200);
        $this->apiPost('/v2/safeguarding/withdraw-guardian-consent', ['assignment_id' => $id])->assertStatus(200);
        $this->apiPost('/v2/safeguarding/consent-to-guardian', ['assignment_id' => $id])->assertStatus(200);

        $events = $this->events($id);
        $this->assertCount(3, $events, 'Each real change must append exactly one row.');
        // Phase 5: the trail lives in account_relationship_events, whose
        // vocabulary spells agreement 'approved'.
        $this->assertSame(
            ['approved', 'withdrawn', 'approved'],
            array_map(static fn ($e) => $e->action, $events),
            'The trail must preserve the order of what actually happened.'
        );
        foreach ($events as $event) {
            $this->assertSame('member', $event->actor_role);
            $this->assertSame((int) $ward->id, (int) $event->actor_user_id, 'Every row must name who acted.');
        }
    }

    public function test_the_audit_trail_cannot_be_rewritten(): void
    {
        // Enforced by BEFORE UPDATE / BEFORE DELETE triggers, not by convention —
        // a safeguarding trail that application code can edit is not a trail.
        [, $ward, $id] = $this->makeAssignment();
        Sanctum::actingAs($ward);
        $this->apiPost('/v2/safeguarding/decline-guardian', ['assignment_id' => $id])->assertStatus(200);

        $eventId = $this->events($id)[0]->id;

        try {
            DB::table('account_relationship_events')->where('id', $eventId)->update(['action' => 'approved']);
            $this->fail('Updating an audit row must be refused by the database.');
        } catch (\Throwable $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }

        try {
            DB::table('account_relationship_events')->where('id', $eventId)->delete();
            $this->fail('Deleting an audit row must be refused by the database.');
        } catch (\Throwable $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }

        $this->assertSame('declined', $this->events($id)[0]->action);
    }

    public function test_a_ward_sees_their_own_arrangements_with_a_state(): void
    {
        [, $ward, $id] = $this->makeAssignment(['consent_declined_at' => now()]);
        Sanctum::actingAs($ward);

        $response = $this->apiGet('/v2/safeguarding/my-guardians')->assertStatus(200);

        $guardians = $response->json('data.guardians');
        $this->assertCount(1, $guardians);
        $this->assertSame($id, (int) $guardians[0]['id']);
        $this->assertSame('declined', $guardians[0]['state']);
        $this->assertSame('Grace Guardian', $guardians[0]['guardian_name']);
        // Drives the prompt shown outside Settings.
        $this->assertSame(0, $response->json('data.pending_count'));
    }

    public function test_pending_count_reflects_only_unanswered_arrangements(): void
    {
        [, $ward, ] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->assertSame(1, $this->apiGet('/v2/safeguarding/my-guardians')->json('data.pending_count'));
    }

    public function test_a_guardian_can_see_who_they_support_and_the_wards_answer(): void
    {
        // 🔴 The guardian previously had NO screen at all: they were emailed that
        // an arrangement existed and could not see it, or whether the ward agreed.
        [$guardian, , ] = $this->makeAssignment(['consent_given_at' => now()]);
        Sanctum::actingAs($guardian);

        $wards = $this->apiGet('/v2/safeguarding/my-wards')->assertStatus(200)->json('data.wards');

        $this->assertCount(1, $wards);
        $this->assertSame('Wendy Ward', $wards[0]['ward_name']);
        $this->assertSame('consented', $wards[0]['state']);
    }

    public function test_a_ward_is_not_listed_as_a_guardian_of_themselves(): void
    {
        [, $ward, ] = $this->makeAssignment();
        Sanctum::actingAs($ward);

        $this->assertSame([], $this->apiGet('/v2/safeguarding/my-wards')->json('data.wards'));
    }
}
