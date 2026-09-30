<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\Category;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-431 blast radius — six gates that read `users.role` and nothing else.
 *
 * Administrator authority on this platform lives in two places at once:
 * `users.role`, and four boolean flags (`is_admin`, `is_super_admin`,
 * `is_tenant_super_admin`, `is_god`). `App\Support\Authorization\AdminTier`
 * is the canonical predicate and treats each as independently sufficient.
 *
 * `TenantHierarchyService::assignTenantSuperAdmin()` has always granted a
 * network administrator by writing the FLAG and no role, and the F-431 fix
 * makes `AdminUsersController::setSuperAdmin()` do the same, so that grant and
 * revoke are exact inverses. The resulting account is
 * `role = 'member'` + `is_tenant_super_admin = 1`.
 *
 * Any gate that compares the role string alone therefore refuses a real
 * network administrator. These six did:
 *
 *   KnowledgeBaseController::index()        unpublished articles in the list
 *   KnowledgeBaseController::show()         an unpublished article by id
 *   KnowledgeBaseController::showBySlug()   an unpublished article by slug
 *   ResourcePublicController::update()      editing someone else's resource
 *   ResourcePublicController::destroy()     deleting someone else's resource
 *   VolunteerCheckInController::canManageShift()  the shift check-in register
 *
 * Every test carries its own control: an ordinary member — identical but for
 * the flag — must still be refused. This is a restoration of access, so the
 * control is the half that proves nothing was widened.
 */
final class NetworkAdminReachesRoleStringGatesTest extends TestCase
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

    // ── KnowledgeBaseController::index() ────────────────────────────────────

    public function test_network_admin_sees_unpublished_articles_in_the_knowledge_base_list(): void
    {
        $author = $this->plainMember();
        $category = Category::factory()->forTenant($this->testTenantId)->create(['type' => 'resource']);
        $articleId = $this->article($author, (int) $category->id, published: false);

        $uri = '/v2/kb?include_unpublished=1&per_page=100&category_id=' . (int) $category->id;

        // HARM — the network administrator as the platform now grants one.
        $this->actAs($this->networkAdmin());
        $adminList = $this->apiGet($uri);
        self::assertSame(200, $adminList->getStatusCode(), $adminList->getContent());
        self::assertContains(
            $articleId,
            array_map('intval', array_column((array) $adminList->json('data'), 'id')),
            'F-431 blast radius: a network administrator (flag set, role member) must see unpublished articles'
        );

        // CONTROL — an ordinary member must still not.
        $this->actAs($this->plainMember());
        $memberList = $this->apiGet($uri);
        self::assertSame(200, $memberList->getStatusCode(), $memberList->getContent());
        self::assertNotContains(
            $articleId,
            array_map('intval', array_column((array) $memberList->json('data'), 'id')),
            'control: an ordinary member must never see an unpublished article'
        );
    }

    // ── KnowledgeBaseController::show() ─────────────────────────────────────

    public function test_network_admin_reads_an_unpublished_article_by_id(): void
    {
        $author = $this->plainMember();
        $articleId = $this->article($author, null, published: false);

        $this->actAs($this->networkAdmin());
        $admin = $this->apiGet('/v2/kb/' . $articleId);
        self::assertSame(
            200,
            $admin->getStatusCode(),
            'F-431 blast radius: a network administrator must be able to preview an unpublished article. '
            . $admin->getContent()
        );

        $this->actAs($this->plainMember());
        $member = $this->apiGet('/v2/kb/' . $articleId);
        self::assertSame(
            404,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused the unpublished article'
        );
    }

    // ── KnowledgeBaseController::showBySlug() ───────────────────────────────

    public function test_network_admin_reads_an_unpublished_article_by_slug(): void
    {
        $author = $this->plainMember();
        $slug = 'e074d-unpublished-' . uniqid();
        $articleId = $this->article($author, null, published: false, slug: $slug);

        $this->actAs($this->networkAdmin());
        $admin = $this->apiGet('/v2/kb/slug/' . $slug);
        self::assertSame(
            200,
            $admin->getStatusCode(),
            'F-431 blast radius: a network administrator must reach the unpublished article by slug. '
            . $admin->getContent()
        );
        self::assertSame($articleId, (int) $admin->json('data.id'));

        // The admin preview must not have counted as a public view.
        self::assertSame(
            0,
            (int) DB::table('knowledge_base_articles')->where('id', $articleId)->value('views_count'),
            'an administrator preview is not a member view'
        );

        $this->actAs($this->plainMember());
        $member = $this->apiGet('/v2/kb/slug/' . $slug);
        self::assertSame(
            404,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused the unpublished article by slug'
        );
    }

    // ── ResourcePublicController::update() ──────────────────────────────────

    public function test_network_admin_edits_a_resource_they_do_not_own(): void
    {
        $owner = $this->plainMember();
        $resourceId = $this->resource($owner);

        $this->actAs($this->networkAdmin());
        $admin = $this->apiPut('/v2/resources/' . $resourceId, ['title' => 'Retitled by the network administrator']);
        self::assertSame(
            200,
            $admin->getStatusCode(),
            'F-431 blast radius: a network administrator must be able to edit a community resource. '
            . $admin->getContent()
        );
        self::assertSame(
            'Retitled by the network administrator',
            (string) DB::table('resources')->where('id', $resourceId)->value('title')
        );

        $this->actAs($this->plainMember());
        $member = $this->apiPut('/v2/resources/' . $resourceId, ['title' => 'Retitled by a passer-by']);
        self::assertSame(
            403,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused another member\'s resource'
        );
        self::assertSame(
            'Retitled by the network administrator',
            (string) DB::table('resources')->where('id', $resourceId)->value('title'),
            'control: the refused edit changed nothing'
        );
    }

    // ── ResourcePublicController::destroy() ─────────────────────────────────

    public function test_network_admin_deletes_a_resource_they_do_not_own(): void
    {
        $owner = $this->plainMember();
        $resourceId = $this->resource($owner);

        // CONTROL FIRST — deletion is destructive, so prove the refusal on the
        // row that is still there.
        $this->actAs($this->plainMember());
        $member = $this->apiDelete('/v2/resources/' . $resourceId);
        self::assertSame(
            403,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused deletion of another member\'s resource'
        );
        self::assertTrue(
            DB::table('resources')->where('id', $resourceId)->exists(),
            'control: the refused deletion removed nothing'
        );

        $this->actAs($this->networkAdmin());
        $admin = $this->apiDelete('/v2/resources/' . $resourceId);
        self::assertSame(
            200,
            $admin->getStatusCode(),
            'F-431 blast radius: a network administrator must be able to remove a community resource. '
            . $admin->getContent()
        );
        self::assertFalse(DB::table('resources')->where('id', $resourceId)->exists());
    }

    // ── VolunteerCheckInController::canManageShift() ────────────────────────

    public function test_network_admin_reads_the_shift_check_in_register(): void
    {
        $shiftId = $this->shift();

        $this->actAs($this->networkAdmin());
        $admin = $this->apiGet('/v2/volunteering/shifts/' . $shiftId . '/checkins');
        self::assertSame(
            200,
            $admin->getStatusCode(),
            'F-431 blast radius: a network administrator must be able to run volunteer check-in. '
            . $admin->getContent()
        );

        $this->actAs($this->plainMember());
        $member = $this->apiGet('/v2/volunteering/shifts/' . $shiftId . '/checkins');
        self::assertSame(
            403,
            $member->getStatusCode(),
            'control: an ordinary member must still be refused the shift check-in register'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($user->id), ['*']);
    }

    /**
     * A network administrator exactly as the platform now grants one:
     * the flag, and no role. Nothing else distinguishes it from a member.
     */
    private function networkAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
            'is_god' => 0,
        ]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertTrue(AdminTier::allows((array) $row), 'precondition: canonically an admin-tier account');

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function plainMember(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ]);
        $row = DB::table('users')->where('id', $u->id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        self::assertFalse(AdminTier::allows((array) $row), 'precondition: no admin-tier authority');

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function article(User $author, ?int $categoryId, bool $published, ?string $slug = null): int
    {
        return (int) DB::table('knowledge_base_articles')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $author->id,
            'title' => 'E074D unpublished fixture',
            'slug' => $slug ?? ('e074d-kb-' . uniqid()),
            'content' => 'Draft body, not yet published.',
            'category_id' => $categoryId,
            'is_published' => $published,
            'views_count' => 0,
            'sort_order' => 0,
            'created_at' => now(),
        ]);
    }

    private function resource(User $owner): int
    {
        return (int) DB::table('resources')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'E074D resource fixture',
            'file_path' => '',
            'sort_order' => 0,
            'created_at' => now(),
        ]);
    }

    private function shift(): int
    {
        $orgOwner = $this->plainMember();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'E074D Check-in Org',
            'slug' => 'e074d-checkin-org-' . uniqid(),
            'description' => 'Organisation fixture for the check-in register gate.',
            'status' => 'active',
            'created_at' => now(),
        ]);

        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'E074D Check-in Opportunity',
            'description' => 'Opportunity fixture for the check-in register gate.',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        return (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->subMinutes(5),
            'end_time' => now()->addHour(),
            'capacity' => 5,
            'created_at' => now(),
        ]);
    }
}
