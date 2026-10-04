<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\SafeguardingService;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-467 (E-075 A-4) — a network administrator must be able to be given a
 * safeguarding case, and must appear on the administrator roster.
 *
 * The F-431 companion `5e61de34a` looked at permission GATES. A second
 * population of queries selects WHICH ACCOUNTS ARE ADMINISTRATORS —
 * eligibility rosters and recipient lists — and selected on `users.role` alone.
 * A network administrator (`is_tenant_super_admin` = 1, `role` = 'member') was
 * invisible to all of them:
 *
 *   SafeguardingService::assignDlp()             the Designated Liaison Person
 *       for a volunteering safeguarding incident. It returned false and left
 *       `assigned_to` NULL — nobody responsible for the incident.
 *   SafeguardingService::assignOrganizationDlp() the DLP for an organisation.
 *   SafeguardingService::updateIncident()        the `assigned_to` validation.
 *   AdminCrmController::listAdmins()             the roster the CRM screen
 *       renders; it read `is_admin` and omitted the other three flags.
 *
 * These tests assert the CORRECT behaviour. Eligibility here is BROKER-TIER,
 * not admin-tier: brokers and coordinators are deliberately eligible to be a
 * DLP, because the bell points at a screen gated by BrokerRoute. So the control
 * that proves no widening is the ordinary MEMBER, who must still be refused,
 * and for the CRM roster — which is admin-only — a broker must stay absent.
 */
final class F467SafeguardingRostersIncludeANetworkAdminTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    /**
     * A safeguarding incident must be assignable to a network administrator,
     * and the stored row is the evidence.
     */
    public function test_a_safeguarding_incident_can_be_assigned_to_a_network_admin(): void
    {
        $service = app(SafeguardingService::class);
        $actor = $this->roleStringAdmin();
        $incidentId = $this->incident($actor);

        $networkAdmin = $this->networkAdmin();
        $fixed = $service->assignDlp($incidentId, (int) $networkAdmin->id, (int) $actor->id, $this->testTenantId);

        self::assertTrue($fixed, 'a real network administrator can be made DLP');
        self::assertSame(
            (int) $networkAdmin->id,
            (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'),
            'and the incident really records them as responsible'
        );

        // CONTROL (legitimate access, unchanged) — the identical call for an
        // ordinary community administrator still succeeds.
        $roleAdmin = $this->roleStringAdmin();
        self::assertTrue(
            $service->assignDlp($incidentId, (int) $roleAdmin->id, (int) $actor->id, $this->testTenantId),
            'control: a role-string administrator can still be assigned'
        );
        self::assertSame(
            (int) $roleAdmin->id,
            (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'),
            'control: and the incident records them'
        );

        // CONTROL (no widening) — an ordinary member must still be refused, and
        // the existing assignment must be untouched.
        $member = $this->plainMember();
        self::assertFalse(
            $service->assignDlp($incidentId, (int) $member->id, (int) $actor->id, $this->testTenantId),
            'control: an ordinary member must never be made DLP'
        );
        self::assertSame(
            (int) $roleAdmin->id,
            (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'),
            'control: and the existing assignment is untouched'
        );

        // CONTROL (no widening) — a suspended network administrator is still
        // refused, so the status check is not weakened by the fix.
        $suspended = $this->networkAdmin();
        DB::table('users')->where('id', $suspended->id)->update(['status' => 'suspended']);
        self::assertFalse(
            $service->assignDlp($incidentId, (int) $suspended->id, (int) $actor->id, $this->testTenantId),
            'control: a suspended account must never be made DLP'
        );
    }

    /**
     * The `assigned_to` validation on an incident update is a second copy of
     * the same roster and must accept the same account.
     */
    public function test_an_incident_update_accepts_a_network_admin_as_assignee(): void
    {
        $service = app(SafeguardingService::class);
        $actor = $this->roleStringAdmin();
        $incidentId = $this->incident($actor);
        $networkAdmin = $this->networkAdmin();

        self::assertTrue(
            $service->updateIncident(
                $incidentId,
                ['assigned_to' => (int) $networkAdmin->id],
                (int) $actor->id,
                $this->testTenantId
            ),
            'a real network administrator is accepted as the assignee'
        );
        self::assertSame(
            (int) $networkAdmin->id,
            (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'),
            'and the update really lands'
        );

        // CONTROL (legitimate access, unchanged).
        $roleAdmin = $this->roleStringAdmin();
        self::assertTrue(
            $service->updateIncident(
                $incidentId,
                ['assigned_to' => (int) $roleAdmin->id],
                (int) $actor->id,
                $this->testTenantId
            ),
            'control: a role-string administrator is still accepted'
        );

        // CONTROL (no widening) — an ordinary member is still refused and the
        // update is rejected whole.
        self::assertFalse(
            $service->updateIncident(
                $incidentId,
                ['assigned_to' => (int) $this->plainMember()->id],
                (int) $actor->id,
                $this->testTenantId
            ),
            'control: an ordinary member must never be accepted as assignee'
        );
        self::assertSame(
            (int) $roleAdmin->id,
            (int) DB::table('vol_safeguarding_incidents')->where('id', $incidentId)->value('assigned_to'),
            'control: and the existing assignee is untouched'
        );
    }

    /**
     * The organisation DLP was the third copy of the same roster.
     *
     * 🔴 4 Oct 2026, owner decision: the organisation DLP is no longer a roster.
     * Any ACTIVE member of the community may be named, because it is a record
     * that grants no access and sends no notifications (the incident-level DLP,
     * tested above, still requires a broker-tier role). The original control —
     * "an ordinary member must never be the organisation DLP" — was therefore
     * replaced by the control that still matters: a suspended account is refused
     * and leaves the existing DLP untouched. The F-467 property itself (a
     * network administrator is accepted) is unchanged.
     */
    public function test_an_organisation_dlp_can_be_a_network_admin(): void
    {
        $service = app(SafeguardingService::class);
        $actor = $this->roleStringAdmin();
        $organizationId = $this->organization($actor);
        $networkAdmin = $this->networkAdmin();

        self::assertTrue(
            $service->assignOrganizationDlp(
                $organizationId,
                (int) $networkAdmin->id,
                (int) $actor->id,
                $this->testTenantId
            ),
            'a real network administrator can be the organisation DLP'
        );
        self::assertSame(
            (int) $networkAdmin->id,
            (int) DB::table('vol_organizations')->where('id', $organizationId)->value('dlp_user_id'),
            'and the organisation really records them'
        );

        // CONTROL (legitimate access, unchanged).
        $roleAdmin = $this->roleStringAdmin();
        self::assertTrue(
            $service->assignOrganizationDlp(
                $organizationId,
                (int) $roleAdmin->id,
                (int) $actor->id,
                $this->testTenantId
            ),
            'control: a role-string administrator is still accepted'
        );

        // CONTROL — a suspended account is still refused (owner decision 4 Oct
        // 2026 opened this to any ACTIVE member, not to every account).
        $suspended = $this->plainMember();
        DB::table('users')->where('id', $suspended->id)->update(['status' => 'suspended']);
        self::assertFalse(
            $service->assignOrganizationDlp(
                $organizationId,
                (int) $suspended->id,
                (int) $actor->id,
                $this->testTenantId
            ),
            'control: a suspended account must never be the organisation DLP'
        );
        self::assertSame(
            (int) $roleAdmin->id,
            (int) DB::table('vol_organizations')->where('id', $organizationId)->value('dlp_user_id'),
            'control: and the existing DLP is untouched'
        );
    }

    /**
     * The CRM administrator roster must list the same account.
     */
    public function test_a_network_admin_appears_on_the_crm_administrator_roster(): void
    {
        $networkAdmin = $this->networkAdmin();
        $roleAdmin = $this->roleStringAdmin();
        $member = $this->plainMember();
        $broker = $this->broker();

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($roleAdmin->id), ['*']);
        $response = $this->apiGet('/v2/admin/crm/admins');
        self::assertSame(200, $response->getStatusCode(), $response->getContent());

        $ids = array_map('intval', array_column((array) ($response->json('data') ?? []), 'id'));

        self::assertContains(
            (int) $networkAdmin->id,
            $ids,
            'a real network administrator appears on the administrator roster. ' . $response->getContent()
        );

        // CONTROL (legitimate access, unchanged) — the ordinary administrator
        // is still listed, so an "everything matches" result is not what this
        // rests on.
        self::assertContains(
            (int) $roleAdmin->id,
            $ids,
            'control: the roster still lists a role-string administrator. ' . $response->getContent()
        );

        // CONTROL (no widening) — an ordinary member stays absent.
        self::assertNotContains(
            (int) $member->id,
            $ids,
            'control: an ordinary member is correctly absent. ' . $response->getContent()
        );

        // CONTROL (no widening) — this roster is admin-tier, so a broker stays
        // absent. AdminTier deliberately refuses broker and coordinator.
        self::assertNotContains(
            (int) $broker->id,
            $ids,
            'control: a broker is correctly absent from the administrator roster. ' . $response->getContent()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function incident(User $reporter): int
    {
        return (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reported_by' => (int) $reporter->id,
            'incident_type' => 'concern',
            'severity' => 'high',
            'description' => 'E075 F467 synthetic safeguarding fixture',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function organization(User $owner): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'name' => 'E075 F467 synthetic organisation',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function networkAdmin(): User
    {
        $u = $this->account(['is_tenant_super_admin' => 1]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertTrue(AdminTier::allows((array) $row), 'precondition: canonically admin-tier');
        self::assertSame('member', (string) $row->role, 'precondition: and no admin role string');

        return $u;
    }

    private function roleStringAdmin(): User
    {
        return $this->account(['role' => 'admin', 'is_admin' => 1]);
    }

    private function broker(): User
    {
        $u = $this->account(['role' => 'broker']);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertFalse(AdminTier::allows((array) $row), 'precondition: a broker is never admin-tier');

        return $u;
    }

    private function plainMember(): User
    {
        $u = $this->account([]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertFalse(AdminTier::allows((array) $row), 'precondition: no admin-tier authority');

        return $u;
    }

    /** @param array<string,mixed> $flags */
    private function account(array $flags): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'status' => 'active',
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }
}
