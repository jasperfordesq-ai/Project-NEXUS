<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Events\CommunityEventCreated;
use App\Events\GdprActionOccurred;
use App\Events\ListingCreated;
use App\Events\VolunteerOpportunityCreated;
use App\Listeners\NotifyAdminOfGdprAction;
use App\Listeners\NotifyAdminOfNewCommunityEvent;
use App\Listeners\NotifyAdminOfNewListing;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Listeners\NotifyAdminOfNewVolunteerOpportunity;
use App\Models\Event as CommunityEventModel;
use App\Models\Listing;
use App\Models\User;
use App\Models\VolOpportunity;
use App\Services\TenantVisibilityService;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-490 (E-075 I-1) — four admin-alert queries selected administrators by role
 * string, so a community could reach a state where a statutory data-subject
 * request alerted nobody.
 *
 * `super_admin`, `god`, `tenant_admin` and `coordinator` are never written to
 * `users.role` by the API; that authority is carried by boolean flags with
 * `role` usually left at `member`. Both live grant routes write exactly that
 * state, and `AdminSuperController` records that `role='member'` plus
 * `is_tenant_super_admin=1` is a supported state. F-431 made it the normal
 * result of appointing an administrator, which widened this gap rather than
 * creating it.
 *
 *   NotifyAdminOfGdprAction                  a statutory erasure / access /
 *       portability request: no bell, no push, no email to anyone.
 *   NotifyAdminOfNewListing                  new listings go unreviewed.
 *   NotifyAdminOfNewCommunityEvent           new community events go unreviewed.
 *   NotifyAdminOfNewVolunteerOpportunity     new volunteering goes unreviewed.
 *
 * The correct predicate already existed two files away in
 * `NotifyAdminOfNewRegistration::recipientsFor()`, whose docblock records that
 * the role-only form "silently lost real admins" and was reported from a real
 * community as the top-priority fault. These tests assert the CORRECT
 * behaviour, driving each listener end to end.
 *
 * Every assertion is scoped to ids this test creates, in communities this test
 * creates — nothing counts rows platform-wide or in the shared fixtures.
 */
final class F490AdminAlertsReachFlagGrantedAdminsTest extends TestCase
{
    use DatabaseTransactions;

    private int $flagTenantId = 0;
    private int $roleTenantId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        // A community whose ONLY administrator was granted the way the platform
        // now grants one: the flag, no role change.
        $this->flagTenantId = $this->makeTenant('e075-f490-flag-only');

        // A comparison community with an ordinary role='admin' administrator.
        $this->roleTenantId = $this->makeTenant('e075-f490-role-admin');
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    /**
     * THE HARM — a community whose only administrator holds
     * `is_tenant_super_admin` must still be alerted to a statutory
     * data-subject request.
     */
    public function test_a_data_subject_request_alerts_a_flag_granted_administrator(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $member = $this->member($this->flagTenantId);

        // The account really does hold admin authority by the canonical predicate.
        self::assertTrue(
            AdminTier::allows(DB::table('users')->where('id', $networkAdmin)->first()),
            'precondition: the account is an administrator by the canonical predicate'
        );

        $this->fireGdpr($this->flagTenantId, $member, 'f490-flag');

        self::assertSame(
            1,
            $this->bellCount($networkAdmin),
            'the only administrator this community has is alerted to the request'
        );
        self::assertSame(
            '/admin/enterprise/gdpr',
            (string) DB::table('notifications')->where('user_id', $networkAdmin)->orderByDesc('id')->value('link'),
            'and the alert points at the GDPR queue'
        );

        // CONTROL (no widening) — the ordinary member who made the request is
        // not alerted, so this is not simply notifying the whole community.
        self::assertSame(0, $this->bellCount($member), 'control: an ordinary member is not alerted');
    }

    /**
     * CONTROL (legitimate access, unchanged) — the same listener, the same
     * event shape, differing only in how the authority is recorded.
     */
    public function test_control_a_role_admin_is_still_alerted_by_the_same_listener(): void
    {
        $roleAdmin = $this->roleAdmin($this->roleTenantId);
        $member = $this->member($this->roleTenantId);

        $this->fireGdpr($this->roleTenantId, $member, 'f490-role');

        self::assertSame(1, $this->bellCount($roleAdmin), 'control: a role=admin administrator is alerted exactly once');
        self::assertSame(0, $this->bellCount($member), 'control: and the member is not');
    }

    /**
     * SIBLING — a new listing must reach the flag-granted administrator.
     */
    public function test_a_new_listing_alerts_a_flag_granted_administrator(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $roleAdmin = $this->roleAdmin($this->flagTenantId);
        $member = $this->member($this->flagTenantId);
        $poster = $this->member($this->flagTenantId);

        $listing = $this->listing($this->flagTenantId, $poster);
        (new NotifyAdminOfNewListing())->handle(new ListingCreated(
            $listing,
            User::withoutGlobalScopes()->findOrFail($poster),
            $this->flagTenantId,
        ));

        self::assertSame(1, $this->bellCount($networkAdmin), 'the network administrator is told a listing needs review');
        self::assertSame(1, $this->bellCount($roleAdmin), 'control: and the role-string administrator still is');
        self::assertSame(0, $this->bellCount($member), 'control: an ordinary member is not');
    }

    /**
     * SIBLING — a new volunteering opportunity must reach the same account.
     */
    public function test_a_new_volunteer_opportunity_alerts_a_flag_granted_administrator(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $roleAdmin = $this->roleAdmin($this->flagTenantId);
        $member = $this->member($this->flagTenantId);

        $opportunity = $this->opportunity($this->flagTenantId);
        (new NotifyAdminOfNewVolunteerOpportunity())->handle(
            new VolunteerOpportunityCreated($opportunity, $this->flagTenantId)
        );

        self::assertSame(1, $this->bellCount($networkAdmin), 'the network administrator is told volunteering needs review');
        self::assertSame(1, $this->bellCount($roleAdmin), 'control: and the role-string administrator still is');
        self::assertSame(0, $this->bellCount($member), 'control: an ordinary member is not');
    }

    /**
     * SIBLING — a new community event must reach the same account.
     */
    public function test_a_new_community_event_alerts_a_flag_granted_administrator(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $roleAdmin = $this->roleAdmin($this->flagTenantId);
        $member = $this->member($this->flagTenantId);
        $organiser = $this->member($this->flagTenantId);

        $this->enableEventsFeature($this->flagTenantId);
        $communityEvent = $this->communityEvent($this->flagTenantId, $organiser);
        (new NotifyAdminOfNewCommunityEvent())->handle(
            new CommunityEventCreated($communityEvent, $this->flagTenantId)
        );

        self::assertGreaterThanOrEqual(
            1,
            $this->bellCount($networkAdmin),
            'the network administrator is told a community event needs review'
        );
        self::assertGreaterThanOrEqual(
            1,
            $this->bellCount($roleAdmin),
            'control: and the role-string administrator still is'
        );
        self::assertSame(0, $this->bellCount($member), 'control: an ordinary member is not');
        self::assertSame(0, $this->bellCount($organiser), 'control: and the organiser is deliberately excluded');
    }

    /**
     * SIBLING — the federation partner roster omitted `is_admin` and `is_god`
     * entirely, so an administrator granted either way was absent from the
     * list of people a partner community can contact.
     */
    public function test_the_tenant_admin_roster_lists_every_shape_of_administrator(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $flaggedAdmin = $this->account($this->flagTenantId, ['is_admin' => 1]);
        $godAdmin = $this->account($this->flagTenantId, ['is_god' => 1]);
        $roleAdmin = $this->roleAdmin($this->flagTenantId);
        $member = $this->member($this->flagTenantId);

        $ids = array_map(
            static fn (array $row): int => (int) $row['id'],
            TenantVisibilityService::getTenantAdmins($this->flagTenantId)
        );

        self::assertContains($networkAdmin, $ids, 'a network administrator is on the roster');
        self::assertContains($flaggedAdmin, $ids, 'an is_admin administrator is on the roster');
        self::assertContains($godAdmin, $ids, 'an is_god administrator is on the roster');
        self::assertContains($roleAdmin, $ids, 'control: a role-string administrator still is');
        self::assertNotContains($member, $ids, 'control: an ordinary member is correctly absent');
    }

    /**
     * SIBLING — approving a federation partnership tells the initiating
     * community's administrators. That recipient list read the role string
     * alone, so a community whose administrators hold the flag was never told
     * its partnership request had been accepted.
     *
     * Driven through the real route, so the whole path is exercised.
     */
    public function test_a_partnership_approval_alerts_the_initiators_flag_granted_administrator(): void
    {
        $initiatorNetworkAdmin = $this->flagGrantedAdmin($this->flagTenantId);
        $initiatorRoleAdmin = $this->roleAdmin($this->flagTenantId);
        $initiatorMember = $this->member($this->flagTenantId);

        // The receiving community approves; its own administrator is the actor.
        $receiverAdmin = $this->roleAdmin($this->roleTenantId);
        $partnershipId = $this->pendingPartnership($this->flagTenantId, $this->roleTenantId);

        $this->app['auth']->forgetGuards();
        TenantContext::reset();
        TenantContext::setById($this->roleTenantId);
        Sanctum::actingAs(User::withoutGlobalScopes()->findOrFail($receiverAdmin), ['*']);

        $res = $this->postJson(
            '/api/v2/admin/federation/partnerships/' . $partnershipId . '/approve',
            [],
            ['X-Tenant-ID' => (string) $this->roleTenantId, 'Accept' => 'application/json']
        );
        self::assertSame(200, $res->getStatusCode(), 'the approval was accepted. ' . $res->getContent());

        self::assertSame(
            1,
            $this->bellCount($initiatorNetworkAdmin),
            'the initiating community\'s network administrator is told the partnership was approved'
        );
        self::assertSame(
            1,
            $this->bellCount($initiatorRoleAdmin),
            'control: and its role-string administrator still is'
        );
        self::assertSame(
            0,
            $this->bellCount($initiatorMember),
            'control: an ordinary member of the initiating community is not alerted'
        );
    }

    /**
     * The in-house counter-example these fixes copy: the already-fixed
     * registration listener reaches the same account, in the same community.
     */
    public function test_control_the_already_fixed_registration_listener_agrees(): void
    {
        $networkAdmin = $this->flagGrantedAdmin($this->flagTenantId);

        $ids = NotifyAdminOfNewRegistration::recipientsFor($this->flagTenantId)
            ->map(static fn (object $row): int => (int) $row->id)
            ->all();

        self::assertContains($networkAdmin, $ids, 'control: the fixed registration listener reaches the same account');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function fireGdpr(int $tenantId, int $memberId, string $key): void
    {
        (new NotifyAdminOfGdprAction())->handle(new GdprActionOccurred(
            userId: $memberId,
            tenantId: $tenantId,
            action: GdprActionOccurred::ACTION_REQUEST,
            detail: 'erasure',
            granted: null,
            requestId: null,
            subjectName: 'F490 synthetic member ' . $key,
        ));
    }

    private function bellCount(int $userId): int
    {
        return (int) DB::table('notifications')->where('user_id', $userId)->count();
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** A partnership $initiator has requested from $receiver, awaiting approval. */
    private function pendingPartnership(int $initiatorTenantId, int $receiverTenantId): int
    {
        return (int) DB::table('federation_partnerships')->insertGetId([
            'tenant_id' => $initiatorTenantId,
            'partner_tenant_id' => $receiverTenantId,
            'status' => 'pending',
            'federation_level' => 'basic',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeTenant(string $slug): int
    {
        $unique = $slug . '-' . bin2hex(random_bytes(4));

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'E075 F490 ' . $unique,
            'slug' => $unique,
            'domain' => null,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function enableEventsFeature(int $tenantId): void
    {
        $row = DB::table('tenants')->where('id', $tenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['events'] = true;
        DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($features)]);
        Cache::flush();
        TenantContext::reset();
    }

    /**
     * Exactly what the live grant routes write: the flag set, the role
     * untouched at 'member'.
     */
    private function flagGrantedAdmin(int $tenantId): int
    {
        return $this->account($tenantId, ['is_tenant_super_admin' => 1]);
    }

    private function roleAdmin(int $tenantId): int
    {
        return $this->account($tenantId, ['role' => 'admin', 'is_admin' => 1]);
    }

    private function member(int $tenantId): int
    {
        return $this->account($tenantId, []);
    }

    /** @param array<string,mixed> $flags */
    private function account(int $tenantId, array $flags): int
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'role' => 'member',
        ]);

        DB::table('users')->where('id', (int) $user->id)->update(array_merge([
            'tenant_id' => $tenantId,
            'status' => 'active',
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $flags));

        return (int) $user->id;
    }

    private function listing(int $tenantId, int $posterId): Listing
    {
        $id = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $posterId,
            'title' => 'F490 synthetic listing',
            'description' => 'F490 synthetic listing fixture',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return Listing::withoutGlobalScopes()->findOrFail($id);
    }

    private function opportunity(int $tenantId): VolOpportunity
    {
        $id = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => 'F490 synthetic opportunity',
            'description' => 'F490 synthetic volunteering fixture',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return VolOpportunity::withoutGlobalScopes()->findOrFail($id);
    }

    private function communityEvent(int $tenantId, int $organiserId): CommunityEventModel
    {
        $id = (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organiserId,
            'title' => 'F490 synthetic community event',
            'description' => 'F490 synthetic event fixture',
            'start_time' => now()->addWeek(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return CommunityEventModel::withoutGlobalScopes()->findOrFail($id);
    }
}
