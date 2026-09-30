<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-347 (E-065) — the municipality-announcer grant conferred far more than it said.
 *
 * `POST /api/v2/admin/feed/grant-announcer` is described everywhere it is offered
 * as a FEED capability: the migration that creates the role attaches only
 * feed.post / feed.pin / feed.badge_official / members.view, and the admin
 * toggle in the React panel reads "Posts by this user will display an Official
 * badge and be pinned to the top of the feed".
 *
 * `MunicipalSurveyController` never read those permissions. It matched the ROLE
 * NAME, and its admin routes strip `EnsureIsAdmin` (routes/api.php:4223-4234),
 * so the same grant also allowed survey authoring and `adminExportCsv()` — every
 * response with the respondent's user id and free-text answers.
 *
 * The survey administration endpoints now require an actual administrator. The
 * announcer grant keeps exactly the feed behaviour it advertises.
 *
 * Adapted from the E-065 slice-D reproduction
 * `.local-docs-archive/security-log/E-065/repro/d/AnnouncerRoleScopeCreepTest.php`,
 * which asserted the BAD outcome (it passed while the bug existed). The attack
 * assertions below are inverted.
 */
final class F347AnnouncerSurveyScopeTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $adminId = 0;
    private int $announcerId = 0;
    private int $respondentId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        $this->enableCaringCommunity();
        TenantContext::setById(self::TENANT);

        $this->seedAnnouncerRoleAsTheMigrationDoes();

        $this->adminId = $this->makeUser('e066d.admin', 'admin', isAdmin: true);
        $this->announcerId = $this->makeUser('e066d.announcer', 'member');
        $this->respondentId = $this->makeUser('e066d.respondent', 'member');
    }

    /**
     * The feed-announcer grant must NOT open survey authoring.
     */
    public function test_announcer_grant_cannot_create_a_municipal_survey(): void
    {
        $this->grantAnnouncerThroughTheAdminEndpoint();

        // The announcer is an ordinary member: no admin role, no admin flag.
        $row = DB::table('users')->where('id', $this->announcerId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        $this->assertSame('member', (string) $row->role);
        $this->assertEmpty($row->is_admin);
        $this->assertEmpty($row->is_tenant_super_admin);

        Sanctum::actingAs(User::find($this->announcerId));

        $title = 'F347 announcer survey ' . bin2hex(random_bytes(4));
        $create = $this->postJson('/api/v2/admin/caring-community/surveys', [
            'title' => $title,
            'is_anonymous' => false,
            'questions' => [[
                'question_text' => 'Which support do you need at home?',
                'question_type' => 'open_text',
                'is_required' => true,
                'sort_order' => 1,
            ]],
        ], $this->withTenantHeader());

        $this->assertSame(
            403,
            $create->getStatusCode(),
            'BAD OUTCOME: a plain member holding only the FEED announcer grant created a '
            . 'municipal survey. Body: ' . $create->getContent()
        );
        $this->assertNull(
            DB::table('municipality_surveys')
                ->where('tenant_id', self::TENANT)
                ->where('title', $title)
                ->first(),
            'BAD OUTCOME: the survey row was written despite the refusal.'
        );
    }

    /**
     * The feed-announcer grant must NOT open the per-respondent answer export.
     */
    public function test_announcer_grant_cannot_export_survey_responses(): void
    {
        $this->grantAnnouncerThroughTheAdminEndpoint();

        $surveyId = $this->seedSurveyDirectly();
        $answer = 'I need help washing and dressing in the mornings.';
        $this->seedResponse($surveyId, $answer);

        Sanctum::actingAs(User::find($this->announcerId));

        $export = $this->getJson(
            '/api/v2/admin/caring-community/surveys/' . $surveyId . '/export',
            $this->withTenantHeader()
        );

        $this->assertSame(
            403,
            $export->getStatusCode(),
            'BAD OUTCOME: the feed announcer downloaded the per-respondent export. Body: '
            . substr($export->getContent(), 0, 400)
        );
        $this->assertStringNotContainsString($answer, $export->getContent());
    }

    /**
     * CONTROL — a real administrator still creates and exports surveys, so the
     * two cases above do not pass because the module broke.
     */
    public function test_control_administrator_still_creates_and_exports_surveys(): void
    {
        Sanctum::actingAs(User::find($this->adminId));

        $title = 'F347 admin survey ' . bin2hex(random_bytes(4));
        $create = $this->postJson('/api/v2/admin/caring-community/surveys', [
            'title' => $title,
            'is_anonymous' => false,
            'questions' => [[
                'question_text' => 'Which support do you need at home?',
                'question_type' => 'open_text',
                'is_required' => true,
                'sort_order' => 1,
            ]],
        ], $this->withTenantHeader());

        $this->assertSame(201, $create->getStatusCode(), 'CONTROL body: ' . $create->getContent());

        $surveyId = (int) data_get($create->json(), 'data.id', data_get($create->json(), 'id', 0));
        $this->assertGreaterThan(0, $surveyId, 'survey id not returned: ' . $create->getContent());

        $this->seedResponse($surveyId, 'control answer text');

        $export = $this->getJson(
            '/api/v2/admin/caring-community/surveys/' . $surveyId . '/export',
            $this->withTenantHeader()
        );
        $this->assertSame(200, $export->getStatusCode(), 'CONTROL export body: ' . $export->getContent());
        $this->assertStringContainsString('control answer text', $export->getContent());
    }

    /**
     * CONTROL — the announcer keeps the capability it was actually granted: a
     * feed post it writes is still badged official.
     */
    public function test_control_announcer_still_posts_official_feed_notices(): void
    {
        $this->grantAnnouncerThroughTheAdminEndpoint();

        Sanctum::actingAs(User::find($this->announcerId));

        $content = 'F347 official notice ' . bin2hex(random_bytes(4));
        $post = $this->postJson('/api/v2/feed/posts', ['content' => $content], $this->withTenantHeader());

        $this->assertSame(201, $post->getStatusCode(), 'CONTROL feed body: ' . $post->getContent());
        $row = DB::table('feed_posts')
            ->where('tenant_id', self::TENANT)
            ->where('content', $content)
            ->first(['is_official']);
        $this->assertNotNull($row, 'CONTROL: the announcer post was not stored.');
        $this->assertSame(
            1,
            (int) $row->is_official,
            'CONTROL: the announcer must keep the official-badge capability the grant advertises.'
        );
    }

    /**
     * CONTROL — the same grant does NOT reach the emergency-alert admin routes.
     * Those routes keep `EnsureIsAdmin` (routes/api.php:2390-2392), so the
     * in-controller announcer branch there is unreachable. Kept from the E-065
     * reproduction so the two are not confused.
     */
    public function test_control_announcer_cannot_reach_emergency_alert_admin_routes(): void
    {
        $this->grantAnnouncerThroughTheAdminEndpoint();

        Sanctum::actingAs(User::find($this->announcerId));

        $response = $this->postJson('/api/v2/admin/caring-community/emergency-alerts', [
            'title' => 'F347 alert',
            'message' => 'F347 alert body',
            'severity' => 'high',
        ], $this->withTenantHeader());

        $this->assertSame(403, $response->getStatusCode());
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function grantAnnouncerThroughTheAdminEndpoint(): void
    {
        Sanctum::actingAs(User::find($this->adminId));

        $response = $this->postJson(
            '/api/v2/admin/feed/grant-announcer',
            ['user_id' => $this->announcerId],
            $this->withTenantHeader()
        );

        if ($response->getStatusCode() !== 200) {
            $this->markTestSkipped(
                'grant-announcer unavailable in this fixture (' . $response->getStatusCode()
                . '): ' . $response->getContent()
            );
        }

        $this->assertTrue(
            DB::table('user_roles')
                ->join('roles', 'roles.id', '=', 'user_roles.role_id')
                ->where('user_roles.user_id', $this->announcerId)
                ->where('roles.name', 'municipality_announcer')
                ->exists(),
            'the grant endpoint must have written the announcer row'
        );
    }

    /**
     * The clone's `roles` table is empty, so recreate exactly what migration
     * 2026_04_27_163333_add_municipality_announcer_role.php writes in production:
     * a platform-global, is_system role carrying ONLY the four feed permissions.
     */
    private function seedAnnouncerRoleAsTheMigrationDoes(): void
    {
        DB::table('roles')->insertOrIgnore([
            'name' => 'municipality_announcer',
            'display_name' => 'Municipality Announcer',
            'description' => 'Verified municipal authority that can post pinned official notices to the community feed.',
            'level' => 5,
            'is_system' => 1,
            'tenant_id' => null,
        ]);

        $roleId = (int) DB::table('roles')->where('name', 'municipality_announcer')->value('id');

        foreach ([
            ['feed.post', 'Post to Feed', 'feed'],
            ['feed.pin', 'Pin Feed Posts', 'feed'],
            ['feed.badge_official', 'Badge Posts as Official', 'feed'],
            ['members.view', 'View Members', 'members'],
        ] as [$name, $display, $category]) {
            DB::table('permissions')->insertOrIgnore([
                'name' => $name,
                'display_name' => $display,
                'category' => $category,
            ]);
            $permId = (int) DB::table('permissions')->where('name', $name)->value('id');
            DB::table('role_permissions')->insertOrIgnore([
                'role_id' => $roleId,
                'permission_id' => $permId,
                'tenant_id' => null,
            ]);
        }
    }

    private function seedSurveyDirectly(): int
    {
        $surveyId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id' => self::TENANT,
            'title' => 'F347 direct survey ' . bin2hex(random_bytes(4)),
            'status' => 'active',
            'is_anonymous' => 0,
            'created_by' => $this->adminId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('municipality_survey_questions')->insert([
            'tenant_id' => self::TENANT,
            'survey_id' => $surveyId,
            'question_text' => 'Which support do you need at home?',
            'question_type' => 'open_text',
            'is_required' => 1,
            'sort_order' => 1,
            'created_at' => now(),
        ]);

        return $surveyId;
    }

    private function seedResponse(int $surveyId, string $answer): void
    {
        $questionId = (int) (DB::table('municipality_survey_questions')
            ->where('survey_id', $surveyId)
            ->value('id') ?? 0);

        DB::table('municipality_survey_responses')->insert([
            'tenant_id' => self::TENANT,
            'survey_id' => $surveyId,
            'user_id' => $this->respondentId,
            'answers' => json_encode([(string) $questionId => $answer]),
            'submitted_at' => now(),
        ]);
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        $features['feed'] = true;
        DB::table('tenants')->where('id', self::TENANT)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function makeUser(string $prefix, string $role, bool $isAdmin = false): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F347 User',
            'first_name' => 'F347',
            'last_name' => 'User',
            'email' => $email,
            'username' => 'f347_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => $role,
            'is_admin' => $isAdmin ? 1 : 0,
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
