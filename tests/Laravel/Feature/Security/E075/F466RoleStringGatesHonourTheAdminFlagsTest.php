<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-466 (E-075 A-3) — three more permission gates compared the role string
 * without the admin flags, and refused a real network administrator.
 *
 * The F-431 companion commit `5e61de34a` fixed six such gates and recorded that
 * every other role-string gate "was read and needed nothing", naming
 * JobVacanciesController among the clean. That was wrong for one of that file's
 * three admin checks. Two further controllers were in neither list:
 *
 *   EmergencyAlertController::hasAnnouncerAccess()   the community EMERGENCY
 *       ALERT broadcast. Its routes sit INSIDE the EnsureIsAdmin group, which
 *       uses AdminTier and admits the account — so the request passed the gate
 *       at the door and was refused by a narrower rule inside the controller.
 *   JobVacanciesController::downloadCv()             an inline check that did
 *       not even SELECT the flag columns, in a file whose two other admin
 *       helpers read all four.
 *   PostAnalyticsController::analytics()
 *
 * These tests assert the CORRECT behaviour: a network administrator — the
 * account the platform now grants (`is_tenant_super_admin` = 1, `role` =
 * 'member') — holds the control. Each case carries both controls: a role-string
 * administrator still succeeds, and an ordinary member and a broker are still
 * refused, so nothing here widens access beyond the admin tier.
 */
final class F466RoleStringGatesHonourTheAdminFlagsTest extends TestCase
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

    // ── EmergencyAlertController::hasAnnouncerAccess() ──────────────────────

    public function test_network_admin_can_raise_an_emergency_alert(): void
    {
        $this->enableFeature('caring_community');
        $payload = [
            'title' => 'E075 F466 flood warning',
            'body' => 'E075 F466 synthetic drill notice.',
            'severity' => 'warning',
        ];

        // THE CONTROL THAT WAS BEING REFUSED — a network administrator holds
        // admin-tier authority (the route's own EnsureIsAdmin middleware admits
        // them) and must not then be refused inside the controller.
        $this->actAs($this->networkAdmin());
        $fixed = $this->apiPost('/v2/admin/caring-community/emergency-alerts', $payload);
        self::assertSame(
            201,
            $fixed->getStatusCode(),
            'a real network administrator raises the emergency alert. ' . $fixed->getContent()
        );
        self::assertNotEmpty(
            $fixed->json('data'),
            'and an alert record comes back. ' . $fixed->getContent()
        );

        // CONTROL (legitimate access, unchanged) — an ordinary community
        // administrator, differing only in where the authority is stored.
        $this->actAs($this->roleStringAdmin());
        $control = $this->apiPost('/v2/admin/caring-community/emergency-alerts', $payload);
        self::assertSame(
            201,
            $control->getStatusCode(),
            'control: a role-string administrator still raises the alert. ' . $control->getContent()
        );

        // CONTROL (no widening) — a plain member must never broadcast.
        $this->actAs($this->plainMember());
        $member = $this->apiPost('/v2/admin/caring-community/emergency-alerts', $payload);
        self::assertContains(
            $member->getStatusCode(),
            [401, 403],
            'control: an ordinary member must never raise an emergency alert. ' . $member->getContent()
        );

        // CONTROL (no widening) — a broker is an operational role, not a
        // junior administrator, even carrying a stale admin flag.
        $this->actAs($this->brokerWithStaleFlag());
        $broker = $this->apiPost('/v2/admin/caring-community/emergency-alerts', $payload);
        self::assertContains(
            $broker->getStatusCode(),
            [401, 403],
            'control: a broker must never raise an emergency alert. ' . $broker->getContent()
        );
    }

    // ── JobVacanciesController::downloadCv() ────────────────────────────────

    public function test_network_admin_can_reach_a_job_application_cv(): void
    {
        $this->enableFeature('job_vacancies');
        $poster = $this->plainMember();
        $applicant = $this->plainMember();
        $applicationId = $this->jobApplication($poster, $applicant);

        // THE CONTROL THAT WAS BEING REFUSED — a network administrator must get
        // past the authorisation branch and be stopped only by the absent file,
        // a different error code further down the method.
        $this->actAs($this->networkAdmin());
        $fixed = $this->apiGet('/v2/jobs/applications/' . $applicationId . '/cv');
        self::assertStringNotContainsString(
            'RESOURCE_FORBIDDEN',
            (string) $fixed->getContent(),
            'a real network administrator is not refused the application. ' . $fixed->getContent()
        );
        self::assertStringContainsString(
            'RESOURCE_NOT_FOUND',
            (string) $fixed->getContent(),
            'and reaches the branch that reports the CV is absent. ' . $fixed->getContent()
        );

        // CONTROL (legitimate access, unchanged) — a role-string administrator.
        $this->actAs($this->roleStringAdmin());
        $control = $this->apiGet('/v2/jobs/applications/' . $applicationId . '/cv');
        self::assertStringNotContainsString(
            'RESOURCE_FORBIDDEN',
            (string) $control->getContent(),
            'control: the administrator still gets past the authorisation branch. ' . $control->getContent()
        );

        // CONTROL (no widening) — an unrelated member stays refused.
        $this->actAs($this->plainMember());
        $outsider = $this->apiGet('/v2/jobs/applications/' . $applicationId . '/cv');
        self::assertStringContainsString(
            'RESOURCE_FORBIDDEN',
            (string) $outsider->getContent(),
            'control: an unrelated member must stay refused. ' . $outsider->getContent()
        );

        // CONTROL (no widening) — a broker stays refused.
        $this->actAs($this->brokerWithStaleFlag());
        $broker = $this->apiGet('/v2/jobs/applications/' . $applicationId . '/cv');
        self::assertStringContainsString(
            'RESOURCE_FORBIDDEN',
            (string) $broker->getContent(),
            'control: a broker must stay refused. ' . $broker->getContent()
        );
    }

    // ── PostAnalyticsController::analytics() ────────────────────────────────

    public function test_network_admin_can_read_post_analytics(): void
    {
        $author = $this->plainMember();
        $postId = $this->feedPost($author);

        $this->actAs($this->networkAdmin());
        $fixed = $this->apiGet('/v2/feed/posts/' . $postId . '/analytics');
        self::assertSame(
            200,
            $fixed->getStatusCode(),
            'a real network administrator reads the post analytics. ' . $fixed->getContent()
        );
        self::assertArrayHasKey(
            'views_count',
            (array) ($fixed->json('data') ?? []),
            'and real analytics come back. ' . $fixed->getContent()
        );

        $this->actAs($this->roleStringAdmin());
        $control = $this->apiGet('/v2/feed/posts/' . $postId . '/analytics');
        self::assertSame(
            200,
            $control->getStatusCode(),
            'control: a role-string administrator still reads the analytics. ' . $control->getContent()
        );

        $this->actAs($this->plainMember());
        $member = $this->apiGet('/v2/feed/posts/' . $postId . '/analytics');
        self::assertSame(
            403,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused. ' . $member->getContent()
        );

        $this->actAs($this->brokerWithStaleFlag());
        $broker = $this->apiGet('/v2/feed/posts/' . $postId . '/analytics');
        self::assertSame(
            403,
            $broker->getStatusCode(),
            'control: a broker must still be refused. ' . $broker->getContent()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function enableFeature(string $feature): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features[$feature] = true;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        self::assertTrue(TenantContext::hasFeature($feature), 'precondition: ' . $feature . ' is on');
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($user->id), ['*']);
    }

    /** The account the platform now grants: the flag, and no role. */
    private function networkAdmin(): User
    {
        $u = $this->account(['is_tenant_super_admin' => 1]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertTrue(AdminTier::allows((array) $row), 'precondition: canonically admin-tier');
        self::assertSame('member', (string) $row->role, 'precondition: and no admin role string');

        return $u;
    }

    /** An ordinary community administrator, authority in the role string. */
    private function roleStringAdmin(): User
    {
        return $this->account(['role' => 'admin', 'is_admin' => 1]);
    }

    private function plainMember(): User
    {
        $u = $this->account([]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertFalse(AdminTier::allows((array) $row), 'precondition: no admin-tier authority');

        return $u;
    }

    /**
     * A broker carrying a stale admin flag. AdminTier deliberately fails closed
     * for broker and coordinator, so this account must be refused everywhere
     * below — it is the strongest proof the fix does not widen access.
     */
    private function brokerWithStaleFlag(): User
    {
        $u = $this->account(['role' => 'broker', 'is_admin' => 1]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertFalse(AdminTier::allows((array) $row), 'precondition: a broker is never admin-tier');

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
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function jobApplication(User $poster, User $applicant): int
    {
        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $poster->id,
            'title' => 'E075 F466 vacancy',
            'description' => 'E075 F466 fixture vacancy',
            'status' => 'open',
            'type' => 'full_time',
            'commitment' => 'permanent',
            'is_remote' => 0,
            'views_count' => 0,
            'applications_count' => 0,
            'renewal_count' => 0,
            'salary_negotiable' => 0,
            'is_featured' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id' => (int) $applicant->id,
            'status' => 'pending',
            'stage' => 'applied',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function feedPost(User $author): int
    {
        return (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $author->id,
            'content' => 'E075 F466 fixture post',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
