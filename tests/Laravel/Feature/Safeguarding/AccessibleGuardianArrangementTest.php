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
 * Guardian arrangements on the ACCESSIBLE (GOV.UK) frontend.
 *
 * 🔴 Why this matters more here than anywhere else. When the ward-facing consent
 * screen was built, it was built only in the React app. This frontend — the
 * HTML-first one intended for people who need a highly accessible experience —
 * was left with no screen at all, so a member using it could not see a
 * safeguarding arrangement made about them, agree to it, refuse it, or withdraw.
 * The population most likely to be under such an arrangement is precisely the
 * population most likely to be using this frontend.
 *
 * These tests prove the page renders AND that the three answers actually work
 * through plain form POSTs, with no JavaScript involved.
 */
class AccessibleGuardianArrangementTest extends TestCase
{
    use DatabaseTransactions;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->path = "/{$this->testTenantSlug}/accessible/settings/guardians";
    }

    /**
     * Seed a staff-proposed arrangement in its phase-5 home:
     * account_relationships, at tier 0, marked by proposed_by_user_id. The
     * old-name overrides are translated so the test bodies read unchanged.
     *
     * @return array{0:User,1:User,2:int} [guardian, ward, assignmentId]
     */
    private function seedArrangement(array $overrides = []): array
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

        $id = (int) DB::table('account_relationships')->insertGetId([
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
            'staff_notes'         => $overrides['notes'] ?? 'Recorded during onboarding.',
            'approved_at'         => $overrides['consent_given_at'] ?? null,
            'declined_at'         => $overrides['consent_declined_at'] ?? null,
            'withdrawn_at'        => $overrides['consent_withdrawn_at'] ?? null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        return [$guardian, $ward, $id];
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

    public function test_the_page_requires_a_signed_in_member(): void
    {
        $this->get($this->path)->assertRedirect();
    }

    public function test_a_ward_sees_the_arrangement_and_can_answer_without_javascript(): void
    {
        [, $ward, $id] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $response = $this->get($this->path);

        $response->assertOk();
        $response->assertSee('Grace Guardian');
        $response->assertSee('Recorded during onboarding.');
        $response->assertSee(__('govuk_alpha_settings.guardians.state_pending'));

        // The record grants nothing, and the page has to keep saying so.
        $response->assertSee(__('govuk_alpha_settings.guardians.intro'));

        // Every action is a plain POST form with a submit button — no JS needed.
        $response->assertSee(
            route('govuk-alpha.settings.guardians.respond', ['tenantSlug' => $this->testTenantSlug]),
            false
        );
        $response->assertSee('name="assignment_id"', false);
        $response->assertSee('value="consented"', false);
        $response->assertSee('value="declined"', false);
        $response->assertSee(__('govuk_alpha_settings.guardians.agree_button'));
        $response->assertSee(__('govuk_alpha_settings.guardians.decline_button'));
    }

    public function test_the_reason_field_is_offered_and_is_not_required(): void
    {
        [, $ward, ] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $response = $this->get($this->path);

        $response->assertSee('name="reason"', false);
        // The hint must state plainly that a reason is optional — requiring
        // somebody to justify refusing a safeguarding arrangement is pressure to
        // agree, so the copy has to say the opposite.
        $response->assertSee(__('govuk_alpha_settings.guardians.reason_hint'));
        $response->assertDontSee('required aria-describedby="reason', false);
    }

    public function test_a_ward_can_agree_through_the_form(): void
    {
        [, $ward, $id] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->post("{$this->path}/respond", ['assignment_id' => $id, 'action' => 'consented'])
            ->assertRedirect();

        $this->assertNotNull($this->row($id)->consent_given_at);
    }

    public function test_a_ward_can_refuse_through_the_form_with_a_reason(): void
    {
        [, $ward, $id] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->post("{$this->path}/respond", [
            'assignment_id' => $id,
            'action' => 'declined',
            'reason' => 'Not comfortable with this yet',
        ])->assertRedirect();

        $row = $this->row($id);
        $this->assertNotNull($row->consent_declined_at);
        $this->assertSame('Not comfortable with this yet', $row->ward_response_reason);
        $this->assertNull($row->consent_given_at);
    }

    public function test_a_ward_can_withdraw_through_the_form(): void
    {
        [, $ward, $id] = $this->seedArrangement(['consent_given_at' => now()]);
        Sanctum::actingAs($ward);

        $this->post("{$this->path}/respond", ['assignment_id' => $id, 'action' => 'withdrawn'])
            ->assertRedirect();

        $this->assertNotNull($this->row($id)->consent_withdrawn_at);
    }

    public function test_an_illegal_transition_is_refused_and_reported(): void
    {
        // Withdrawing without ever agreeing.
        [, $ward, $id] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->post("{$this->path}/respond", ['assignment_id' => $id, 'action' => 'withdrawn'])
            ->assertRedirect("{$this->path}?status=guardian-not-allowed");

        $this->assertNull($this->row($id)->consent_withdrawn_at);
    }

    public function test_an_unknown_action_is_rejected(): void
    {
        [, $ward, $id] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->post("{$this->path}/respond", ['assignment_id' => $id, 'action' => 'revoked'])
            ->assertRedirect("{$this->path}?status=guardian-failed");

        $row = $this->row($id);
        $this->assertNull($row->consent_given_at);
        $this->assertNull($row->consent_declined_at);
    }

    public function test_a_guardian_cannot_answer_on_the_wards_behalf(): void
    {
        [$guardian, , $id] = $this->seedArrangement();
        Sanctum::actingAs($guardian);

        $this->post("{$this->path}/respond", ['assignment_id' => $id, 'action' => 'consented'])
            ->assertRedirect("{$this->path}?status=guardian-not-found");

        $this->assertNull($this->row($id)->consent_given_at);
    }

    public function test_a_guardian_sees_who_they_support_and_that_it_grants_nothing(): void
    {
        [$guardian, , ] = $this->seedArrangement(['consent_given_at' => now()]);
        Sanctum::actingAs($guardian);

        $response = $this->get($this->path);

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.guardians.wards_title'));
        $response->assertSee('Wendy Ward');
        $response->assertSee(__('govuk_alpha_settings.guardians.ward_state_consented'));
        $response->assertSee(__('govuk_alpha_settings.guardians.wards_intro'));
    }

    public function test_the_guardian_section_is_absent_for_a_member_who_supports_nobody(): void
    {
        [, $ward, ] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->get($this->path)->assertDontSee(__('govuk_alpha_settings.guardians.wards_title'));
    }

    public function test_a_member_with_no_arrangements_is_told_so_rather_than_shown_a_blank_page(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($user);

        $this->get($this->path)
            ->assertOk()
            ->assertSee(__('govuk_alpha_settings.guardians.none'));
    }

    public function test_the_page_is_reachable_from_the_settings_hub(): void
    {
        // An unlinked page is an undiscoverable one — this is the entry point.
        [, $ward, ] = $this->seedArrangement();
        Sanctum::actingAs($ward);

        $this->get("/{$this->testTenantSlug}/accessible/profile/settings")
            ->assertOk()
            ->assertSee(
                route('govuk-alpha.settings.guardians', ['tenantSlug' => $this->testTenantSlug]),
                false
            );
    }
}
