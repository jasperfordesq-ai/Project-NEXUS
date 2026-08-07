<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\GovukAlpha;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Parity coverage for the accessible (GOV.UK) settings module additions:
 *   - Linked / sub-account management (React LinkedAccountsTab)
 *   - Appearance / theme settings (React AppearanceSettings)
 *
 * Mirrors the auth-gating, tenant-pinning and helper conventions of
 * tests/Laravel/Feature/GovukAlphaFrontendTest.php (which keeps these helpers
 * private), reproduced here so this file stands alone.
 */
class SettingsAuthParityTest extends TestCase
{
    use DatabaseTransactions;

    protected int $testTenantId = 2;
    protected string $testTenantSlug = 'hour-timebank';

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();

        foreach ([
            'HTTP_X_TENANT_ID',
            'HTTP_X_TENANT_SLUG',
            'HTTP_AUTHORIZATION',
            'REDIRECT_HTTP_AUTHORIZATION',
        ] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        \Illuminate\Support\Facades\Cache::flush();
    }

    // =====================================================================
    //  Linked / sub-account management
    // =====================================================================

    public function test_settings_linked_accounts_requires_authentication(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_linked_accounts_request_requires_authentication(): void
    {
        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/request", [
            'email' => 'someone@example.com',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_linked_accounts_page_renders_empty_state(): void
    {
        $this->authenticatedUser(['name' => 'Linker One']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.linked.title'));
        $response->assertSee(__('govuk_alpha_settings.linked.children_empty'));
        $response->assertSee(__('govuk_alpha_settings.linked.parents_empty'));
        $response->assertSee(__('govuk_alpha_settings.linked.request_heading'));
    }

    public function test_settings_linked_accounts_page_shows_existing_children_and_parents(): void
    {
        $me = $this->authenticatedUser(['name' => 'Manager Me']);
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'first_name' => 'Childy', 'last_name' => 'McChild', 'name' => 'Childy McChild']);
        $parent = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'first_name' => 'Parenty', 'last_name' => 'McParent', 'name' => 'Parenty McParent']);

        DB::table('account_relationships')->insert([
            [
                'parent_user_id' => $me->id, 'child_user_id' => $child->id, 'tenant_id' => $this->testTenantId,
                'relationship_type' => 'family', 'permissions' => json_encode(['can_view_activity' => true]),
                'status' => 'active', 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ],
            [
                'parent_user_id' => $parent->id, 'child_user_id' => $me->id, 'tenant_id' => $this->testTenantId,
                'relationship_type' => 'carer', 'permissions' => json_encode(['can_view_activity' => true]),
                'status' => 'pending', 'approved_at' => null, 'created_at' => now(), 'updated_at' => now(),
            ],
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");

        $response->assertOk();
        $response->assertSee('Childy McChild');
        $response->assertSee('Parenty McParent');
        // Pending parent request offers an approve action.
        $response->assertSee(__('govuk_alpha_settings.linked.approve_button'));
        $response->assertSee(__('govuk_alpha_settings.linked.status_pending'));
    }

    public function test_settings_linked_accounts_request_with_invalid_email_redirects_with_status(): void
    {
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/request", [
            'email' => 'not-an-email',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-email-invalid', (string) $response->headers->get('Location'));
    }

    public function test_settings_linked_accounts_request_unknown_email_reports_not_found(): void
    {
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/request", [
            'email' => 'nobody-here-' . uniqid() . '@example.com',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-user-not-found', (string) $response->headers->get('Location'));
    }

    public function test_settings_linked_accounts_request_persists_relationship(): void
    {
        $me = $this->authenticatedUser(['name' => 'Requester Me']);
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'email' => 'link-child-' . uniqid() . '@example.com',
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/request", [
            'email' => $child->email,
            'relationship_type' => 'family',
            'perm_can_view_activity' => '1',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-requested', (string) $response->headers->get('Location'));
        $this->assertDatabaseHas('account_relationships', [
            'parent_user_id' => $me->id,
            'child_user_id' => $child->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_settings_linked_accounts_maps_safeguarding_denial_without_writing(): void
    {
        $me = $this->authenticatedUser(['name' => 'Protected Requester']);
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email' => 'protected-child-' . uniqid() . '@example.com',
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($me->id, $child->id, $this->testTenantId, 'sub_account_request')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting confirmation needed'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->withSession(['_token' => 'linked-account-safeguarding-test-token'])
            ->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/request", [
                '_token' => 'linked-account-safeguarding-test-token',
                'email' => $child->email,
                'relationship_type' => 'guardian',
                'perm_can_view_messages' => '1',
            ]);

        $response->assertRedirect();
        $response->assertSessionHas('linked_account_safeguarding_error', 'Vetting confirmation needed');
        $this->assertStringContainsString('status=link-vetting-required', (string) $response->headers->get('Location'));
        $this->assertDatabaseMissing('account_relationships', [
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $me->id,
            'child_user_id' => $child->id,
        ]);
    }

    public function test_settings_linked_accounts_approve_activates_pending_relationship(): void
    {
        $me = $this->authenticatedUser(['name' => 'Approver Me']);
        $parent = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $relationshipId = DB::table('account_relationships')->insertGetId([
            'parent_user_id' => $parent->id, 'child_user_id' => $me->id, 'tenant_id' => $this->testTenantId,
            'relationship_type' => 'guardian', 'permissions' => json_encode(['can_view_activity' => true]),
            'status' => 'pending', 'approved_at' => null, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/approve", [
            'relationship_id' => $relationshipId,
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-approved', (string) $response->headers->get('Location'));
        $this->assertDatabaseHas('account_relationships', [
            'id' => $relationshipId,
            'status' => 'active',
        ]);
    }

    public function test_settings_linked_accounts_update_permissions_persists(): void
    {
        $me = $this->authenticatedUser(['name' => 'Perm Me']);
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $relationshipId = DB::table('account_relationships')->insertGetId([
            'parent_user_id' => $me->id, 'child_user_id' => $child->id, 'tenant_id' => $this->testTenantId,
            'relationship_type' => 'family', 'permissions' => json_encode(['can_view_activity' => true]),
            'status' => 'active', 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        // Listings/credits now travel as EXPLICIT tiers from this page — the
        // boolean checkboxes were an escalation hazard (a co_decide grant
        // rendered unticked, and re-saving the form promoted it to represent).
        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/permissions", [
            'relationship_id' => $relationshipId,
            'perm_can_view_activity' => '1',
            'tier_listings' => 'represent',
            'tier_credits' => 'none',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-permissions-saved', (string) $response->headers->get('Location'));

        $row = DB::table('account_relationships')->where('id', $relationshipId)->first();
        $perms = json_decode((string) ($row->permissions ?? '{}'), true) ?: [];
        $this->assertTrue((bool) ($perms['can_manage_listings'] ?? false));
        $this->assertSame('represent', $perms['tiers']['listings'] ?? null);
    }

    /**
     * 🔴 Pins the escalation fix at the page level: saving the form with a
     * co_decide grant selected keeps co_decide. Before the tier selects, this
     * page's checkboxes could only express on/off, and a re-save converted
     * "prepare only" into act-alone authority.
     */
    public function test_settings_linked_accounts_form_preserves_a_co_decide_grant(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $relationshipId = DB::table('account_relationships')->insertGetId([
            'parent_user_id' => $me->id, 'child_user_id' => $child->id, 'tenant_id' => $this->testTenantId,
            'relationship_type' => 'family',
            'permissions' => json_encode([
                'can_view_activity' => true, 'can_manage_listings' => false, 'can_transact' => false,
                'tiers' => ['activity' => 'assist', 'listings' => 'co_decide', 'credits' => 'none'],
            ]),
            'status' => 'active', 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        // The page renders the CURRENT tier selected; a straight re-save posts
        // it back unchanged.
        $page = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");
        $page->assertOk();
        $page->assertSee('tier_listings', false);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/permissions", [
            'relationship_id' => $relationshipId,
            'perm_can_view_activity' => '1',
            'tier_listings' => 'co_decide',
            'tier_credits' => 'none',
        ]);

        $response->assertRedirect();
        $row = DB::table('account_relationships')->where('id', $relationshipId)->first();
        $perms = json_decode((string) ($row->permissions ?? '{}'), true) ?: [];
        $this->assertSame('co_decide', $perms['tiers']['listings'] ?? null, 'Re-saving the form escalated a prepare-only grant.');
    }

    public function test_settings_linked_accounts_revoke_removes_relationship(): void
    {
        $me = $this->authenticatedUser(['name' => 'Revoke Me']);
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $relationshipId = DB::table('account_relationships')->insertGetId([
            'parent_user_id' => $me->id, 'child_user_id' => $child->id, 'tenant_id' => $this->testTenantId,
            'relationship_type' => 'family', 'permissions' => json_encode(['can_view_activity' => true]),
            'status' => 'active', 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/revoke", [
            'relationship_id' => $relationshipId,
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=link-revoked', (string) $response->headers->get('Location'));
        // The service marks the relationship revoked (soft state), so it must no
        // longer appear as active for this parent.
        $this->assertDatabaseMissing('account_relationships', [
            'id' => $relationshipId,
            'status' => 'active',
        ]);
    }

    // =====================================================================
    //  Activity view (React SupportActivityModal parity)
    // =====================================================================

    private function seedActivityRelationship(User $me, User $child, array $permissions, string $status = 'active'): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'parent_user_id' => $me->id, 'child_user_id' => $child->id, 'tenant_id' => $this->testTenantId,
            'relationship_type' => 'family', 'permissions' => json_encode($permissions),
            'status' => $status, 'approved_at' => $status === 'active' ? now() : null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_linked_account_activity_requires_authentication(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/activity/123");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_linked_account_activity_renders_for_an_active_grant(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Viewed', 'last_name' => 'Member', 'name' => 'Viewed Member',
        ]);
        $this->seedActivityRelationship($me, $child, ['can_view_activity' => true]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/activity/{$child->id}");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.linked.activity_title', ['name' => 'Viewed Member']));
        $response->assertSee(__('govuk_alpha_settings.linked.activity_hours_heading'));
        $response->assertSee(__('govuk_alpha_settings.linked.activity_timeline_heading'));
    }

    public function test_activity_link_is_offered_only_when_the_grant_is_on(): void
    {
        $me = $this->authenticatedUser();
        $granted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Granted', 'last_name' => 'Child', 'name' => 'Granted Child',
        ]);
        $ungranted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Ungranted', 'last_name' => 'Child', 'name' => 'Ungranted Child',
        ]);
        $this->seedActivityRelationship($me, $granted, ['can_view_activity' => true]);
        $this->seedActivityRelationship($me, $ungranted, ['can_view_activity' => false]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");

        $response->assertOk();
        // Exactly ONE activity link: for the granted child, none for the other.
        $response->assertSee("linked-accounts/activity/{$granted->id}");
        $response->assertDontSee("linked-accounts/activity/{$ungranted->id}");
    }

    public function test_activity_for_a_stranger_redirects_with_plain_denial(): void
    {
        $this->authenticatedUser();
        $stranger = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/activity/{$stranger->id}");

        $response->assertRedirect();
        $this->assertStringContainsString('status=activity-denied', (string) $response->headers->get('Location'));
    }

    public function test_activity_with_the_grant_off_redirects_with_plain_denial(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->seedActivityRelationship($me, $child, ['can_view_activity' => false]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/activity/{$child->id}");

        $response->assertRedirect();
        $this->assertStringContainsString('status=activity-denied', (string) $response->headers->get('Location'));
    }

    public function test_activity_for_a_pending_relationship_redirects_with_plain_denial(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->seedActivityRelationship($me, $child, ['can_view_activity' => true], 'pending');

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/activity/{$child->id}");

        $response->assertRedirect();
        $this->assertStringContainsString('status=activity-denied', (string) $response->headers->get('Location'));
    }

    // =====================================================================
    //  Message access (consent-gated read-only viewing) — React parity
    // =====================================================================

    /** An ACTIVE consented grant: messages tier assist + the mirror column set. */
    private function seedMessageGrant(User $supporter, User $supported): int
    {
        $id = $this->seedActivityRelationship($supporter, $supported, [
            'can_view_activity' => true,
            'can_view_messages' => false, // the boolean stays dead even while the TIER grants
            'tiers' => ['activity' => 'assist', 'listings' => 'none', 'credits' => 'none', 'messages' => 'assist'],
        ]);
        DB::table('account_relationships')->where('id', $id)->update(['message_access_granted_at' => now()]);

        return $id;
    }

    /** A live session purpose, exactly as the purpose POST would store it. */
    private function withMsgViewPurpose(int $childUserId, string $purpose = 'Test wellbeing check'): static
    {
        return $this->withSession([
            'alpha_msg_view_purpose_' . $childUserId => [
                'purpose' => $purpose,
                'expires' => now()->addMinutes(10)->getTimestamp(),
            ],
        ]);
    }

    public function test_message_access_request_creates_a_pending_ask_not_a_grant(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $relationshipId = $this->seedActivityRelationship($me, $child, ['can_view_activity' => true]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/message-access/request", [
            'relationship_id' => $relationshipId,
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=message-access-requested', (string) $response->headers->get('Location'));
        // The ask exists; the grant does NOT — only the member's yes raises it.
        $this->assertDatabaseHas('support_pending_actions', [
            'relationship_id' => $relationshipId,
            'action_type' => 'message_access_grant',
            'status' => 'pending',
        ]);
        $row = DB::table('account_relationships')->where('id', $relationshipId)->first();
        $this->assertNull($row->message_access_granted_at);
        $tiers = \App\Support\Safeguarding\SupportTiers::resolve(json_decode((string) $row->permissions, true) ?: []);
        $this->assertSame('none', $tiers['messages']);
    }

    public function test_messages_control_renders_all_three_states(): void
    {
        $me = $this->authenticatedUser();
        $askable = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $pending = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $granted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Granted', 'last_name' => 'Member', 'name' => 'Granted Member',
        ]);
        $this->seedActivityRelationship($me, $askable, ['can_view_activity' => true]);
        $pendingRelId = $this->seedActivityRelationship($me, $pending, ['can_view_activity' => true]);
        DB::table('support_pending_actions')->insert([
            'tenant_id' => $this->testTenantId, 'relationship_id' => $pendingRelId,
            'supporter_user_id' => $me->id, 'supported_user_id' => $pending->id,
            'action_type' => 'message_access_grant', 'status' => 'pending',
            'payload' => json_encode(['capability' => 'messages']),
            'token_hash' => hash('sha256', 'test-token-' . $pendingRelId),
            'expires_at' => now()->addDays(14), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->seedMessageGrant($me, $granted);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.linked_messages.request_button'));
        $response->assertSee(__('govuk_alpha_settings.linked_messages.state_pending', ['name' => $pending->name]));
        $response->assertSee("linked-accounts/messages/{$granted->id}");
    }

    public function test_member_sees_disclosure_and_can_withdraw(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Helping', 'last_name' => 'Hand', 'name' => 'Helping Hand',
        ]);
        $me = $this->authenticatedUser();
        $relationshipId = $this->seedMessageGrant($supporter, $me);

        $page = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha_settings.linked_messages.member_disclosure', ['name' => 'Helping Hand']));
        $page->assertSee(__('govuk_alpha_settings.linked_messages.member_withdraw_button'));

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/message-access/withdraw", [
            'relationship_id' => $relationshipId,
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=message-access-withdrawn', (string) $response->headers->get('Location'));
        $row = DB::table('account_relationships')->where('id', $relationshipId)->first();
        $this->assertNull($row->message_access_granted_at);
        $tiers = \App\Support\Safeguarding\SupportTiers::resolve(json_decode((string) $row->permissions, true) ?: []);
        $this->assertSame('none', $tiers['messages']);
    }

    /** 🔴 The purpose form is the front door: no session purpose, no messages. */
    public function test_viewer_without_a_session_purpose_renders_the_purpose_form(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Supported', 'last_name' => 'One', 'name' => 'Supported One',
        ]);
        $this->seedMessageGrant($me, $child);
        $partner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $partner->id,
            'receiver_id' => $child->id, 'body' => 'Must not leak before a purpose', 'is_read' => 0,
            'created_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.linked_messages.purpose_title'));
        $response->assertDontSee('Must not leak before a purpose');
        // And no audit row was written — nothing was viewed.
        $this->assertDatabaseMissing('supporter_message_view_audits', ['supported_user_id' => $child->id]);
    }

    public function test_viewer_with_a_purpose_lists_read_only_and_audits(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Supported', 'last_name' => 'Two', 'name' => 'Supported Two',
        ]);
        $this->seedMessageGrant($me, $child);
        $partner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Partner', 'last_name' => 'Person', 'name' => 'Partner Person',
        ]);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $partner->id,
            'receiver_id' => $child->id, 'body' => 'Visible with a purpose', 'is_read' => 0,
            'created_at' => now(),
        ]);

        $list = $this->withMsgViewPurpose($child->id)
            ->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}");
        $list->assertOk();
        $list->assertSee(__('govuk_alpha_settings.linked_messages.read_only_banner'));
        $list->assertSee("linked-accounts/messages/{$child->id}/{$partner->id}");

        $thread = $this->withMsgViewPurpose($child->id)
            ->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}/{$partner->id}");
        $thread->assertOk();
        $thread->assertSee('Visible with a purpose');
        // Read-only is structural: the page contains no input of any kind.
        $this->assertStringNotContainsString('<textarea', $thread->getContent());
        $this->assertStringNotContainsString('type="text"', $thread->getContent());

        // Both visits were audited, purpose included, before rendering.
        $this->assertDatabaseHas('supporter_message_view_audits', [
            'supporter_user_id' => $me->id, 'supported_user_id' => $child->id,
            'action' => 'list', 'purpose' => 'Test wellbeing check',
        ]);
        $this->assertDatabaseHas('supporter_message_view_audits', [
            'supporter_user_id' => $me->id, 'supported_user_id' => $child->id,
            'partner_user_id' => $partner->id, 'action' => 'read',
        ]);
        // And the member's unread state shows no trace of the visit.
        $this->assertDatabaseHas('messages', ['receiver_id' => $child->id, 'is_read' => 0]);
    }

    public function test_viewer_without_a_grant_is_denied_even_with_a_purpose(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        // Relationship exists, but messages tier was never consented.
        $this->seedActivityRelationship($me, $child, ['can_view_activity' => true]);

        $response = $this->withMsgViewPurpose($child->id)
            ->get("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}");

        $response->assertRedirect();
        $this->assertStringContainsString('status=message-view-denied', (string) $response->headers->get('Location'));
    }

    public function test_purpose_post_stores_session_and_redirects_to_the_viewer(): void
    {
        $me = $this->authenticatedUser();
        $child = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->seedMessageGrant($me, $child);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}/purpose", [
            'reason' => 'safety',
            'detail' => 'Named concern',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/settings/linked-accounts/messages/{$child->id}");
        $stored = session('alpha_msg_view_purpose_' . $child->id);
        $this->assertIsArray($stored);
        $this->assertStringContainsString(__('govuk_alpha_settings.linked_messages.reason_safety'), $stored['purpose']);
        $this->assertStringContainsString('Named concern', $stored['purpose']);
    }

    public function test_conversation_shows_the_merged_notice_and_the_members_own_reminder(): void
    {
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $me = $this->authenticatedUser();
        $partner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->seedMessageGrant($supporter, $me);
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $partner->id,
            'receiver_id' => $me->id, 'body' => 'Hello there', 'is_read' => 0,
            'created_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/messages/{$partner->id}");

        $response->assertOk();
        // ONE cause-agnostic notice…
        $response->assertSee(__('govuk_alpha.messages.visibility_notice'));
        // …and the member's own standing reminder with the way to manage it.
        $response->assertSee(__('govuk_alpha.messages.own_messages_shared_reminder'));
        $response->assertSee(__('govuk_alpha.messages.own_messages_shared_manage'));
    }

    // =====================================================================
    //  Appearance / theme
    // =====================================================================

    public function test_settings_appearance_requires_authentication(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/appearance");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_appearance_page_renders_with_current_theme(): void
    {
        $me = $this->authenticatedUser(['name' => 'Theme Me']);
        DB::table('users')->where('id', $me->id)->update(['preferred_theme' => 'light']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/appearance");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.appearance.title'));
        $response->assertSee(__('govuk_alpha_settings.appearance.themes.light'));
        $response->assertSee(__('govuk_alpha_settings.appearance.themes.dark'));
        $response->assertSee(__('govuk_alpha_settings.appearance.themes.system'));
        // The theme radios render (id scheme is GOV.UK-conventional, so assert the
        // order-independent name/value rather than a brittle exact attribute string).
        $response->assertSee('name="theme" type="radio" value="light"', false);
        $response->assertSee('name="theme" type="radio" value="dark"', false);
    }

    public function test_settings_appearance_update_persists_theme(): void
    {
        $me = $this->authenticatedUser(['name' => 'Save Theme Me']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/appearance", [
            'theme' => 'dark',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/settings/appearance?status=appearance-saved");
        $this->assertDatabaseHas('users', [
            'id' => $me->id,
            'preferred_theme' => 'dark',
        ]);
    }

    public function test_settings_appearance_update_rejects_invalid_theme(): void
    {
        $me = $this->authenticatedUser(['name' => 'Bad Theme Me']);
        DB::table('users')->where('id', $me->id)->update(['preferred_theme' => 'system']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/appearance", [
            'theme' => 'neon-rainbow',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/settings/appearance?status=appearance-invalid");
        // Unchanged.
        $this->assertDatabaseHas('users', [
            'id' => $me->id,
            'preferred_theme' => 'system',
        ]);
    }

    // =====================================================================
    //  GDPR data-subject requests
    // =====================================================================

    public function test_settings_data_rights_requires_authentication(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/data-rights");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_data_rights_request_requires_authentication(): void
    {
        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/data-rights", [
            'request_type' => 'rectification',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_data_rights_page_renders_request_types(): void
    {
        $this->authenticatedUser(['name' => 'Rights Me']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/data-rights");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.gdpr.title'));
        $response->assertSee(__('govuk_alpha_settings.gdpr.types.portability'));
        $response->assertSee(__('govuk_alpha_settings.gdpr.types.rectification'));
        $response->assertSee(__('govuk_alpha_settings.gdpr.types.restriction'));
        $response->assertSee(__('govuk_alpha_settings.gdpr.types.objection'));
        $response->assertSee(__('govuk_alpha_settings.gdpr.your_requests_empty'));
    }

    public function test_settings_data_rights_request_rejects_invalid_type(): void
    {
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/data-rights", [
            'request_type' => 'erasure', // not one of the four self-service types here
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=gdpr-invalid', (string) $response->headers->get('Location'));
    }

    public function test_settings_data_rights_request_persists_request(): void
    {
        $me = $this->authenticatedUser(['name' => 'Submit Rights Me']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/data-rights", [
            'request_type' => 'rectification',
            'notes' => 'My surname is misspelled.',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=gdpr-requested', (string) $response->headers->get('Location'));
        $this->assertDatabaseHas('gdpr_requests', [
            'user_id' => $me->id,
            'tenant_id' => $this->testTenantId,
            'request_type' => 'rectification',
            'status' => 'pending',
        ]);
    }

    public function test_settings_data_rights_request_blocks_duplicate(): void
    {
        $me = $this->authenticatedUser(['name' => 'Dup Rights Me']);

        DB::table('gdpr_requests')->insert([
            'user_id' => $me->id,
            'tenant_id' => $this->testTenantId,
            'request_type' => 'objection',
            'status' => 'pending',
            'priority' => 'normal',
            'requested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/data-rights", [
            'request_type' => 'objection',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=gdpr-duplicate', (string) $response->headers->get('Location'));
    }

    // =====================================================================
    //  Insurance certificates (compliance-gated)
    // =====================================================================

    public function test_settings_insurance_requires_authentication(): void
    {
        $this->enableInsurance();
        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/insurance");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_insurance_404_when_disabled(): void
    {
        $this->disableInsurance();
        $this->authenticatedUser(['name' => 'No Insurance Me']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/insurance");

        $response->assertNotFound();
    }

    public function test_settings_insurance_page_renders_when_enabled(): void
    {
        $this->enableInsurance();
        $this->authenticatedUser(['name' => 'Insurance Me']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/insurance");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha_settings.insurance.title'));
        $response->assertSee(__('govuk_alpha_settings.insurance.certificates_empty'));
        $response->assertSee(__('govuk_alpha_settings.insurance.upload_button'));
    }

    public function test_settings_insurance_page_shows_existing_certificate(): void
    {
        $this->enableInsurance();
        $me = $this->authenticatedUser(['name' => 'Cert Me']);

        DB::table('insurance_certificates')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $me->id,
            'insurance_type' => 'public_liability',
            'provider_name' => 'Acme Cover Ltd',
            'status' => 'verified',
            'created_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/settings/insurance");

        $response->assertOk();
        $response->assertSee('Acme Cover Ltd');
        $response->assertSee(__('govuk_alpha_settings.insurance.types.public_liability'));
        $response->assertSee(__('govuk_alpha_settings.insurance.statuses.verified'));
    }

    public function test_settings_insurance_upload_requires_authentication(): void
    {
        $this->enableInsurance();
        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/insurance", [
            'insurance_type' => 'public_liability',
        ]);

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
    }

    public function test_settings_insurance_upload_404_when_disabled(): void
    {
        $this->disableInsurance();
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/insurance", [
            'insurance_type' => 'public_liability',
        ]);

        $response->assertNotFound();
    }

    public function test_settings_insurance_record_requires_expiry(): void
    {
        $this->enableInsurance();
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/insurance", [
            'insurance_type' => 'public_liability',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=insurance-expiry-required', (string) $response->headers->get('Location'));
    }

    public function test_settings_insurance_record_persists_metadata_only(): void
    {
        $this->enableInsurance();
        $me = $this->authenticatedUser(['name' => 'Insurance Record Me']);

        // A valid PNG file so finfo reports image/png.
        $pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        $file = \Illuminate\Http\Testing\File::create('cert.png');
        file_put_contents($file->getPathname(), $pngBytes);

        // The uploaded file must travel in the data array — Laravel's test client
        // extracts UploadedFile instances from there (post() has no separate files arg).
        $response = $this->post("/{$this->testTenantSlug}/accessible/settings/insurance", [
            'insurance_type' => 'professional_indemnity',
            'provider_name' => 'Indemnity Co',
            'expiry_date' => '2027-01-01',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=insurance-recorded', (string) $response->headers->get('Location'));
        $this->assertDatabaseHas('insurance_certificates', [
            'user_id' => $me->id,
            'tenant_id' => $this->testTenantId,
            'insurance_type' => 'professional_indemnity',
            'provider_name' => 'Indemnity Co',
            'expiry_date' => '2027-01-01',
            'certificate_file_path' => null,
            'policy_number' => null,
            'status' => 'submitted',
        ]);
    }

    // =====================================================================
    //  Helpers (mirrored from GovukAlphaFrontendTest, which keeps them private)
    // =====================================================================

    private function enableInsurance(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'broker_config'],
            ['setting_value' => json_encode(['insurance_enabled' => true]), 'setting_type' => 'json', 'updated_at' => now(), 'created_at' => now()],
        );
    }

    private function disableInsurance(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'broker_config')
            ->delete();
    }

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }
}
