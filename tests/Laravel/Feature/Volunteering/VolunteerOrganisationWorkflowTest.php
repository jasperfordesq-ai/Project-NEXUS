<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Events\VolunteerOrganisationRegistered;
use App\Events\VolunteerOrganisationStatusChanged;
use App\Listeners\NotifyAdminOfNewVolunteerOrganisation;
use App\Listeners\NotifyOwnerOfVolunteerOrganisationDecision;
use App\Models\User;
use App\Services\VolunteerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

/**
 * The volunteering-organisation approval workflow, end to end.
 *
 * Registering an organisation notified NOBODY until 2026-08-28 — not the admins
 * who alone can approve it, and not the member waiting on the decision. Two
 * organisations sat pending for seven weeks and one day before anyone noticed,
 * and only then because a member asked why her name was wrong.
 *
 * These tests pin the four things that were missing: the event fires, the right
 * admins are told, the registrant is told what was decided, and none of it fires
 * when it would be noise.
 */
class VolunteerOrganisationWorkflowTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status'      => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /**
     * Register an organisation the way a member does.
     *
     * The registration event is faked here on purpose: the queue runs
     * synchronously under test, so a real dispatch would fire the admin fanout
     * during setup and every later assertion would be counting that instead of
     * the invocation actually under test.
     *
     * @return array{0: int, 1: User}
     */
    private function registerOrganisation(string $name = 'West Cork Development Partnership'): array
    {
        Event::fake([VolunteerOrganisationRegistered::class]);

        $registrant = $this->member();

        $orgId = VolunteerService::createOrganization($registrant->id, [
            'name'          => $name,
            'description'   => 'A community-led local development organisation supporting social inclusion across the region.',
            'contact_email' => 'contact@example.org',
        ]);

        self::assertNotNull($orgId, 'Fixture organisation was not created: ' . json_encode(VolunteerService::getErrors()));

        return [(int) $orgId, $registrant];
    }

    // =====================================================================
    // Registration tells the admins
    // =====================================================================

    public function test_registering_an_organisation_dispatches_the_event(): void
    {
        Event::fake([VolunteerOrganisationRegistered::class]);

        [$orgId, $registrant] = $this->registerOrganisation();

        Event::assertDispatched(
            VolunteerOrganisationRegistered::class,
            fn (VolunteerOrganisationRegistered $e): bool => $e->organisationId === $orgId
                && $e->tenantId === $this->testTenantId
                && $e->registeredByUserId === $registrant->id,
        );
    }

    public function test_a_registered_organisation_starts_pending_and_invisible(): void
    {
        [$orgId] = $this->registerOrganisation();

        $status = DB::table('vol_organizations')->where('id', $orgId)->value('status');

        self::assertSame('pending', $status);
        self::assertFalse(
            VolunteerService::isApprovedOrganizationStatus($status),
            'A freshly registered organisation must not be publicly visible.',
        );
    }

    public function test_the_admin_fanout_notifies_admins_but_not_brokers(): void
    {
        // A broker is deliberately excluded: AdminTier refuses broker and
        // coordinator, so `requireAdmin()` would refuse them the approval
        // endpoint. Mailing them asks for an action the API will not allow.
        $admin  = $this->member(['role' => 'admin']);
        $broker = $this->member(['role' => 'broker']);
        $member = $this->member(['role' => 'member']);

        [$orgId, $registrant] = $this->registerOrganisation();

        (new NotifyAdminOfNewVolunteerOrganisation())->handle(
            new VolunteerOrganisationRegistered($orgId, $this->testTenantId, $registrant->id)
        );

        self::assertTrue($this->hasNotification($admin->id, 'new_vol_org_registered'), 'the admin was not notified');
        self::assertFalse($this->hasNotification($broker->id, 'new_vol_org_registered'), 'a broker was notified but cannot approve');
        self::assertFalse($this->hasNotification($member->id, 'new_vol_org_registered'), 'an ordinary member was notified');
    }

    public function test_an_admin_identified_only_by_a_flag_is_still_notified(): void
    {
        // Role strings and admin flags are separate in this schema: super admin,
        // god and tenant super admin are never written to users.role. A
        // role-only lookup silently skips them.
        $flagAdmin = $this->member(['role' => 'member', 'is_tenant_super_admin' => true]);

        [$orgId, $registrant] = $this->registerOrganisation();

        (new NotifyAdminOfNewVolunteerOrganisation())->handle(
            new VolunteerOrganisationRegistered($orgId, $this->testTenantId, $registrant->id)
        );

        self::assertTrue(
            $this->hasNotification($flagAdmin->id, 'new_vol_org_registered'),
            'an admin whose authority is a flag rather than a role was skipped',
        );
    }

    public function test_the_admin_fanout_is_skipped_once_the_organisation_is_no_longer_pending(): void
    {
        // The admin create endpoint uses the same service sink and approves
        // immediately, so by the time this queued job runs the row is active.
        $admin = $this->member(['role' => 'admin']);

        [$orgId, $registrant] = $this->registerOrganisation();
        DB::table('vol_organizations')->where('id', $orgId)->update(['status' => 'active']);

        (new NotifyAdminOfNewVolunteerOrganisation())->handle(
            new VolunteerOrganisationRegistered($orgId, $this->testTenantId, $registrant->id)
        );

        self::assertFalse(
            $this->hasNotification($admin->id, 'new_vol_org_registered'),
            'admins were emailed about an organisation that was already approved',
        );
    }

    public function test_the_admin_fanout_runs_once_per_organisation(): void
    {
        $admin = $this->member(['role' => 'admin']);

        [$orgId, $registrant] = $this->registerOrganisation();
        $event = new VolunteerOrganisationRegistered($orgId, $this->testTenantId, $registrant->id);

        (new NotifyAdminOfNewVolunteerOrganisation())->handle($event);
        (new NotifyAdminOfNewVolunteerOrganisation())->handle($event);

        self::assertSame(
            1,
            $this->notificationCount($admin->id, 'new_vol_org_registered'),
            'a redelivered job re-emailed every admin',
        );
    }

    // =====================================================================
    // The decision tells the registrant
    // =====================================================================

    /**
     * @dataProvider decisionProvider
     */
    public function test_the_registrant_is_told_the_outcome(string $from, string $to, string $expectedType): void
    {
        [$orgId, $registrant] = $this->registerOrganisation();
        DB::table('vol_organizations')->where('id', $orgId)->update(['status' => $from]);

        (new NotifyOwnerOfVolunteerOrganisationDecision())->handle(
            new VolunteerOrganisationStatusChanged($orgId, $this->testTenantId, $from, $to)
        );

        self::assertTrue(
            $this->hasNotification($registrant->id, $expectedType),
            sprintf('%s -> %s did not notify the registrant', $from, $to),
        );

        $notification = DB::table('notifications')
            ->where('user_id', $registrant->id)
            ->where('type', $expectedType)
            ->latest('id')
            ->first(['link']);
        $expectedLink = in_array($to, ['active', 'approved'], true)
            ? '/organisations/' . $orgId
            : '/volunteering';
        self::assertSame($expectedLink, $notification?->link);
    }

    /** @return array<string, array{0: string, 1: string, 2: string}> */
    public static function decisionProvider(): array
    {
        return [
            'approved'          => ['pending', 'active', 'vol_org_approved'],
            'approved (legacy)' => ['pending', 'approved', 'vol_org_approved'],
            'declined'          => ['pending', 'declined', 'vol_org_declined'],
            'suspended'         => ['active', 'suspended', 'vol_org_suspended'],
            'reinstated'        => ['suspended', 'active', 'vol_org_reinstated'],
        ];
    }

    public function test_a_transition_that_carries_no_news_stays_silent(): void
    {
        [$orgId, $registrant] = $this->registerOrganisation();

        // Still waiting, and a no-op re-save. Neither is news.
        (new NotifyOwnerOfVolunteerOrganisationDecision())->handle(
            new VolunteerOrganisationStatusChanged($orgId, $this->testTenantId, 'pending', 'pending')
        );
        (new NotifyOwnerOfVolunteerOrganisationDecision())->handle(
            new VolunteerOrganisationStatusChanged($orgId, $this->testTenantId, 'declined', 'pending')
        );

        self::assertSame(
            0,
            DB::table('notifications')->where('user_id', $registrant->id)->where('type', 'LIKE', 'vol_org_%')->count(),
            'a notification was sent that carried no news',
        );
    }

    public function test_a_decline_reason_reaches_the_registrant_email(): void
    {
        [$orgId, $registrant] = $this->registerOrganisation();

        (new NotifyOwnerOfVolunteerOrganisationDecision())->handle(
            new VolunteerOrganisationStatusChanged(
                $orgId,
                $this->testTenantId,
                'pending',
                'declined',
                null,
                'We could not verify this organisation.',
            )
        );

        self::assertTrue($this->hasNotification($registrant->id, 'vol_org_declined'));
    }

    // =====================================================================
    // The admin endpoint drives it
    // =====================================================================

    public function test_the_status_endpoint_accepts_approve_and_decline(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [$orgId] = $this->registerOrganisation();

        // Fake AFTER registering: Event::fake() REPLACES any previous fake, and
        // the registration helper installs its own, so faking first would leave
        // this event unfaked and unrecorded by the time the request runs.
        Event::fake([VolunteerOrganisationStatusChanged::class]);

        \Laravel\Sanctum\Sanctum::actingAs($admin, ['*']);

        // apiPut(), not putJson(): the base helper adds the X-Tenant-ID header,
        // without which the request is rejected as a tenant mismatch.
        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/status", [
            'status' => 'declined',
            'reason' => 'Not enough detail provided.',
        ]);

        $response->assertStatus(200);
        self::assertSame('declined', DB::table('vol_organizations')->where('id', $orgId)->value('status'));

        Event::assertDispatched(
            VolunteerOrganisationStatusChanged::class,
            fn (VolunteerOrganisationStatusChanged $e): bool => $e->organisationId === $orgId
                && $e->previousStatus === 'pending'
                && $e->newStatus === 'declined'
                && $e->reason === 'Not enough detail provided.',
        );
    }

    public function test_the_status_endpoint_still_rejects_a_nonsense_status(): void
    {
        $admin = $this->member(['role' => 'admin']);
        [$orgId] = $this->registerOrganisation();

        \Laravel\Sanctum\Sanctum::actingAs($admin, ['*']);

        $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/status", [
            'status' => 'banana',
        ])->assertStatus(400);
    }

    // =====================================================================

    protected function setUp(): void
    {
        parent::setUp();
        // The listeners guard against redelivery with the cache; a value left
        // by a previous test would silently suppress a fanout under test.
        Cache::flush();
    }

    private function hasNotification(int $userId, string $type): bool
    {
        return $this->notificationCount($userId, $type) > 0;
    }

    private function notificationCount(int $userId, string $type): int
    {
        return DB::table('notifications')
            ->where('user_id', $userId)
            ->where('type', $type)
            ->count();
    }
}
