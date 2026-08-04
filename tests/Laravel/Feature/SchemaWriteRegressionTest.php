<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use App\Services\Agent\AgentExecutor;
use App\Services\ChallengeService;
use App\Services\ContentModerationService;
use App\Services\JobVacancyService;
use App\Services\KiAgentService;
use App\Services\MatchingService;
use App\Services\SuperAdminAuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Real-database regression tests for schema-write bugs found in the
 * 2026-06-12 Fable hunt. MariaDB runs strict=false, so writes that
 * reference phantom tables/columns or invalid enum literals either throw
 * (swallowed by catch-alls) or silently truncate to '' — these tests hit
 * the real tables so any drift fails loudly.
 *
 * Covers:
 *  - MatchingService::getPreferences / savePreferences vs the phantom
 *    match_preference_categories table (saved row must not be discarded).
 *  - JobApplicationHistory: table has NO tenant_id column; model must not
 *    use HasTenantScope and inserts must not include tenant_id.
 *  - ContentModerationService event approval: events.status enum is
 *    ('active','cancelled','completed','draft') — 'published' truncated to ''.
 *  - AgentExecutor / KiAgentService tandem creation: enum is
 *    ('active','paused','completed','cancelled') — 'pending' truncated to ''.
 *  - transactions.status enum is ('pending','completed','cancelled') —
 *    the federation compensating-refund literal must stay valid.
 *  - AdminBlogController::bulkPublish: posts has no published_at column.
 *
 * 2026-07-30 additions — the three `live-defect` entries from the
 * check-db-column-references gate baseline, all resolved as "the code was
 * wrong, the schema was right":
 *  - consent_types is a PLATFORM-GLOBAL catalogue with no tenant_id column;
 *    the admin CRUD invented one, so creating a consent type 500'd for every
 *    admin and the list page was permanently empty.
 *  - ChallengeService::claim used a challenge_claims table that has never
 *    existed; the real claim ledger is user_challenge_progress.reward_claimed.
 *  - MatchingService category preferences live in the match_preferences.categories
 *    JSON column; the match_preference_categories side table never existed.
 */
class SchemaWriteRegressionTest extends TestCase
{
    use DatabaseTransactions;

    private function makeUser(string $emailPrefix = 'schema'): int
    {
        $email = $emailPrefix . '.' . uniqid() . '@example.test';
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'first_name' => 'Test',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // =====================================================================
    // FIX 1 — MatchingService vs phantom match_preference_categories table
    // =====================================================================

    public function test_get_preferences_returns_saved_row_not_defaults(): void
    {
        $userId = $this->makeUser('matchprefs');

        DB::table('match_preferences')->insert([
            'user_id'                => $userId,
            'tenant_id'              => $this->testTenantId,
            'max_distance_km'        => 99,
            'min_match_score'        => 70,
            'notification_frequency' => 'never',
            'notify_hot_matches'     => 0,
            'notify_mutual_matches'  => 0,
            'created_at'             => now(),
            'updated_at'             => now(),
        ]);

        $prefs = MatchingService::getPreferences($userId);

        // Before the fix the phantom match_preference_categories read threw
        // inside the same try block and the catch returned DEFAULT_PREFERENCES,
        // discarding the row above ('monthly', 25km, opt-ins back on).
        $this->assertSame('never', $prefs['notification_frequency']);
        $this->assertSame(99, $prefs['max_distance_km']);
        $this->assertSame(70, $prefs['min_match_score']);
        $this->assertFalse($prefs['notify_hot_matches']);
        $this->assertFalse($prefs['notify_mutual_matches']);
        $this->assertSame([], $prefs['categories']);
    }

    public function test_save_preferences_with_categories_still_saves_main_row(): void
    {
        $userId = $this->makeUser('matchsave');

        $ok = MatchingService::savePreferences($userId, [
            'notification_frequency' => 'weekly',
            'categories'             => [1, 2],
        ]);

        // The categories sync against the phantom table must not fail the save.
        $this->assertTrue($ok);
        $this->assertSame(
            'weekly',
            DB::table('match_preferences')
                ->where('user_id', $userId)
                ->where('tenant_id', $this->testTenantId)
                ->value('notification_frequency')
        );
    }

    // =====================================================================
    // FIX 2 — job_application_history has no tenant_id column
    // =====================================================================

    public function test_log_application_history_inserts_row(): void
    {
        $ownerId = $this->makeUser('jobowner');
        $applicantId = $this->makeUser('jobapplicant');

        $vacancyId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $ownerId,
            'title'       => 'Schema Regression Vacancy',
            'description' => 'Test vacancy for history logging.',
            'status'      => 'open',
            'created_at'  => now(),
        ]);

        $applicationId = (int) DB::table('job_vacancy_applications')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'vacancy_id' => $vacancyId,
            'user_id'    => $applicantId,
            'status'     => 'applied',
            'created_at' => now(),
        ]);

        // Private method — invoke directly so the test exercises the exact
        // insert that silently failed (tenant_id phantom column) in prod.
        $service = app(JobVacancyService::class);
        $method = new \ReflectionMethod(JobVacancyService::class, 'logApplicationHistory');
        $method->setAccessible(true);
        $method->invoke($service, $applicationId, 'applied', 'shortlisted', $ownerId, 'regression test');

        $row = DB::table('job_application_history')
            ->where('application_id', $applicationId)
            ->where('to_status', 'shortlisted')
            ->first();

        $this->assertNotNull($row, 'history row was not inserted — phantom tenant_id column regression?');
        $this->assertSame('applied', $row->from_status);
        $this->assertSame('regression test', $row->notes);
    }

    public function test_job_application_history_model_queries_without_tenant_scope(): void
    {
        // HasTenantScope would inject WHERE tenant_id (nonexistent column)
        // and make every read 500. A plain count must not throw.
        $count = \App\Models\JobApplicationHistory::query()->count();
        $this->assertIsInt($count);
    }

    // =====================================================================
    // FIX 3 — event moderation approval must use 'active' (valid enum)
    // =====================================================================

    public function test_event_moderation_approval_sets_status_active(): void
    {
        $authorId = $this->makeUser('eventauthor');
        $adminId = $this->makeUser('eventadmin');
        DB::table('users')->where('id', $adminId)->update(['role' => 'admin']);

        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $authorId,
            'title'       => 'Schema Regression Event',
            'description' => 'Awaiting moderation.',
            'start_time'  => now()->addDay(),
            'status'      => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
            'created_at'  => now(),
        ]);

        $queueId = (int) DB::table('content_moderation_queue')->insertGetId([
            'tenant_id'    => $this->testTenantId,
            'content_type' => 'event',
            'content_id'   => $eventId,
            'author_id'    => $authorId,
            'status'       => 'pending',
            'created_at'   => now(),
        ]);

        $result = ContentModerationService::review($queueId, $this->testTenantId, $adminId, 'approved');

        $this->assertTrue($result['success']);
        // The authoritative publication transition must also maintain the
        // legacy compatibility mirror with the valid enum value `active`.
        $this->assertSame(
            'active',
            DB::table('events')->where('id', $eventId)->value('status')
        );
    }

    // =====================================================================
    // FIX 6 — tandem creation must write 'active' (valid enum)
    // =====================================================================

    public function test_agent_executor_tandem_insert_has_active_status(): void
    {
        $supporterId = $this->makeUser('tandemsup');
        $recipientId = $this->makeUser('tandemrec');

        $method = new \ReflectionMethod(AgentExecutor::class, 'dispatchAction');
        $method->setAccessible(true);
        $method->invoke(null, 'create_tandem', [
            'supporter_id' => $supporterId,
            'recipient_id' => $recipientId,
        ], [], $this->testTenantId);

        $status = DB::table('caring_support_relationships')
            ->where('tenant_id', $this->testTenantId)
            ->where('supporter_id', $supporterId)
            ->where('recipient_id', $recipientId)
            ->value('status');

        // 'pending' is not in the enum ('active','paused','completed','cancelled')
        // and truncated to '' — making approved tandems invisible everywhere.
        $this->assertSame('active', $status);
    }

    public function test_ki_agent_apply_proposal_tandem_insert_has_active_status(): void
    {
        $supporterId = $this->makeUser('kitandemsup');
        $recipientId = $this->makeUser('kitandemrec');

        $method = new \ReflectionMethod(KiAgentService::class, 'applyProposal');
        $method->setAccessible(true);
        $method->invoke(null, [
            'proposal_type' => 'create_tandem',
            'proposal_data' => [
                'supporter_id' => $supporterId,
                'recipient_id' => $recipientId,
            ],
        ], $this->testTenantId);

        $status = DB::table('caring_support_relationships')
            ->where('tenant_id', $this->testTenantId)
            ->where('supporter_id', $supporterId)
            ->where('recipient_id', $recipientId)
            ->value('status');

        $this->assertSame('active', $status);
    }

    // =====================================================================
    // FIX 5 — transactions.status compensating-refund literal
    // =====================================================================

    public function test_transactions_compensating_refund_literal_is_valid_enum(): void
    {
        $senderId = $this->makeUser('fedsender');

        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id'        => $this->testTenantId,
            'sender_id'        => $senderId,
            'amount'           => 1,
            'description'      => 'schema regression tx',
            'status'           => 'pending',
            'transaction_type' => 'transfer',
            'created_at'       => now(),
        ]);

        // Same statement FederationV2Controller now runs on a definitive
        // partner rejection. The old literal 'failed' is not in the enum
        // ('pending','completed','cancelled') and truncated to ''.
        DB::update(
            "UPDATE transactions SET status = 'cancelled' WHERE id = ? AND tenant_id = ? AND sender_id = ?",
            [$txId, $this->testTenantId, $senderId]
        );

        $this->assertSame(
            'cancelled',
            DB::table('transactions')->where('id', $txId)->value('status')
        );
    }

    // =====================================================================
    // FIX 4 — bulk-publish must not write nonexistent posts.published_at
    // =====================================================================

    public function test_bulk_publish_publishes_draft_posts(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $postId = (int) DB::table('posts')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'author_id'  => $admin->id,
            'title'      => 'Bulk Publish Regression Post',
            'slug'       => 'bulk-publish-regression-' . uniqid(),
            'content'    => 'Draft content.',
            'status'     => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/admin/blog/bulk-publish', ['post_ids' => [$postId]]);

        $response->assertStatus(200);
        // Before the fix the UPDATE referenced the nonexistent published_at
        // column, threw, and every post in the batch reported failed.
        $response->assertJsonPath('data.success', 1);
        $response->assertJsonPath('data.failed', 0);
        $this->assertSame(
            'published',
            DB::table('posts')->where('id', $postId)->value('status')
        );
    }

    // =====================================================================
    // FIX 7 — consent_types has no tenant_id column (global catalogue)
    // =====================================================================

    public function test_create_consent_type_inserts_global_row(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'role'            => 'super_admin',
            'is_super_admin'  => 1,
        ]);
        Sanctum::actingAs($superAdmin);

        $slug = 'regression-consent-' . uniqid();

        $response = $this->apiPost('/v2/admin/enterprise/gdpr/consent-types', [
            'slug'          => $slug,
            'name'          => 'Schema Regression Consent',
            'description'   => 'Created by the schema-write regression suite.',
            'category'      => 'functional',
            'is_required'   => 0,
            'display_order' => 3,
        ]);

        // Before the fix the INSERT named a tenant_id column that does not
        // exist, threw, and every admin got HTTP 500 CREATE_FAILED.
        $response->assertStatus(201);

        $row = DB::table('consent_types')->where('slug', $slug)->first();
        $this->assertNotNull($row, 'consent type row was not inserted');
        $this->assertSame('Schema Regression Consent', $row->name);
        // current_text is NOT NULL with no default — omitting it fails the
        // insert just as surely as the phantom column did.
        $this->assertNotSame('', (string) $row->current_text);
    }

    public function test_list_consent_types_returns_catalogue_with_tenant_scoped_counts(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $slug = 'regression-listed-' . uniqid();
        DB::table('consent_types')->insert([
            'slug'            => $slug,
            'name'            => 'Listed Regression Consent',
            'current_version' => '1.0',
            'current_text'    => 'Consent body.',
            'is_active'       => 1,
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        DB::table('user_consents')->insert([
            'user_id'         => $member->id,
            'tenant_id'       => $this->testTenantId,
            'consent_type'    => $slug,
            'consent_given'   => 1,
            'consent_text'    => 'Consent body.',
            'consent_version' => '1.0',
            'given_at'        => now(),
            'created_at'      => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->apiGet('/v2/admin/enterprise/gdpr/consent-types');

        $response->assertStatus(200);

        // The phantom `WHERE ct.tenant_id = ?` filter threw and the catch
        // returned an empty array, so this page was blank for four months.
        $rows = collect($response->json('data'))->where('slug', $slug);
        $this->assertCount(1, $rows, 'global consent type missing from the admin list');
        // Counts stay scoped to the caller's own tenant even though the
        // catalogue row itself is shared.
        $this->assertSame(1, (int) $rows->first()['granted_count']);
        $this->assertSame(0, (int) $rows->first()['denied_count']);
    }

    public function test_tenant_admin_cannot_mutate_global_consent_catalogue(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/enterprise/gdpr/consent-types', [
            'slug' => 'should-not-exist-' . uniqid(),
            'name' => 'Unauthorised',
        ]);

        // consent_types is shared across every community, so a tenant admin
        // must be refused outright — not fail with a 500, and not succeed and
        // silently change GDPR definitions for other tenants.
        $response->assertStatus(403);
    }

    // =====================================================================
    // FIX 8 — challenge claims live in user_challenge_progress
    // =====================================================================

    /** @return array{0:int,1:int} [challengeId, userId] */
    private function makeCompletedChallenge(int $xpReward = 25): array
    {
        $userId = $this->makeUser('challengeclaim');

        $challengeId = (int) DB::table('challenges')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'title'          => 'Schema Regression Challenge',
            'description'    => 'Completed and awaiting claim.',
            'challenge_type' => 'weekly',
            'action_type'    => 'listing_created',
            'target_count'   => 1,
            'xp_reward'      => $xpReward,
            'is_active'      => 1,
            'start_date'     => now()->subDay()->toDateString(),
            'end_date'       => now()->addDay()->toDateString(),
            'created_at'     => now(),
        ]);

        DB::table('user_challenge_progress')->insert([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $userId,
            'challenge_id'   => $challengeId,
            'current_count'  => 1,
            'completed_at'   => now(),
            'reward_claimed' => 0,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        return [$challengeId, $userId];
    }

    public function test_claim_challenge_marks_reward_claimed(): void
    {
        [$challengeId, $userId] = $this->makeCompletedChallenge();

        // Before the fix both the exists() read and the insert() hit a
        // challenge_claims table that has never existed, so claim() always
        // threw and the accessible frontend redirected with
        // status=challenge-claim-failed every single time.
        $this->assertTrue(ChallengeService::claim($challengeId, $userId, $this->testTenantId));

        $row = DB::table('user_challenge_progress')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertSame(1, (int) $row->reward_claimed);
        $this->assertNotNull($row->claimed_at);
    }

    public function test_claim_challenge_twice_awards_once(): void
    {
        [$challengeId, $userId] = $this->makeCompletedChallenge();

        $this->assertTrue(ChallengeService::claim($challengeId, $userId, $this->testTenantId));
        // The flip is a conditional UPDATE on reward_claimed = 0, so a double
        // submit cannot pay the reward out twice.
        $this->assertFalse(ChallengeService::claim($challengeId, $userId, $this->testTenantId));
    }

    public function test_claim_challenge_refused_before_completion(): void
    {
        [$challengeId, $userId] = $this->makeCompletedChallenge();

        DB::table('user_challenge_progress')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $userId)
            ->update(['completed_at' => null]);

        $this->assertFalse(ChallengeService::claim($challengeId, $userId, $this->testTenantId));
        $this->assertSame(
            0,
            (int) DB::table('user_challenge_progress')
                ->where('challenge_id', $challengeId)
                ->where('user_id', $userId)
                ->value('reward_claimed')
        );
    }

    // =====================================================================
    // FIX 9 — category preferences persist in match_preferences.categories
    // =====================================================================

    public function test_save_preferences_persists_categories_to_json_column(): void
    {
        $userId = $this->makeUser('matchcats');

        $this->assertTrue(MatchingService::savePreferences($userId, [
            'notification_frequency' => 'weekly',
            'categories'             => [7, 11],
        ]));

        // The engine reads this column; the removed match_preference_categories
        // side table never existed in any schema.
        $stored = DB::table('match_preferences')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->testTenantId)
            ->value('categories');

        $this->assertSame([7, 11], json_decode((string) $stored, true));
        $this->assertSame([7, 11], MatchingService::getPreferences($userId)['categories']);
    }

    public function test_save_preferences_with_empty_categories_clears_the_column(): void
    {
        $userId = $this->makeUser('matchcatsclear');

        MatchingService::savePreferences($userId, ['categories' => [4]]);
        MatchingService::savePreferences($userId, ['categories' => []]);

        $this->assertNull(
            DB::table('match_preferences')
                ->where('user_id', $userId)
                ->where('tenant_id', $this->testTenantId)
                ->value('categories')
        );
        $this->assertSame([], MatchingService::getPreferences($userId)['categories']);
    }

    // =====================================================================
    // FIX 10 — ChallengeService::create / getAll vs phantom
    //          status / category / starts_at / ends_at
    // =====================================================================
    //
    // Same class of defect as FIX 8, in the two methods of the same service
    // that had no callers, so nothing ever raised it:
    //
    //  - getAll() filtered on `status` and `category`. Neither column exists,
    //    so either filter threw 42S22 on the count() — and getAll has no
    //    catch-all, so the first caller to pass one took a hard 500.
    //  - create() wrote `status`, `category`, `starts_at` and `ends_at`. None
    //    are in Challenge::$fillable, so Eloquent discarded all four SILENTLY
    //    rather than throwing — the caller's category simply vanished. Under
    //    the non-strict session sql_mode this app runs (config/database.php
    //    sets strict => false) that failure mode is invisible.
    //  - Independently, create() defaulted `action_type` and `end_date` to
    //    null when both columns are NOT NULL, so every call threw 1048.
    //
    // These tests hit the real `challenges` table, so reintroducing any of the
    // four phantom keys fails loudly here.

    /** @return array<string,mixed> Payload with every phantom key present. */
    private function phantomChallengePayload(array $overrides = []): array
    {
        return array_merge([
            'title'          => 'Schema Regression Create',
            'description'    => 'Created through the repaired service method.',
            'challenge_type' => 'weekly',
            'action_type'    => 'listing_created',
            'target_count'   => 3,
            'xp_reward'      => 40,
            // The four keys that are NOT columns. They must be tolerated as
            // input (starts_at/ends_at are aliases) or ignored, never written.
            'status'         => 'active',
            'category'       => 'general',
            'starts_at'      => now()->subDay()->toDateString(),
            'ends_at'        => now()->addDays(3)->toDateString(),
        ], $overrides);
    }

    public function test_create_challenge_writes_only_real_columns(): void
    {
        $id = ChallengeService::create($this->testTenantId, $this->phantomChallengePayload());

        $this->assertNotNull($id, 'create() returned null — the insert did not happen');

        $row = DB::table('challenges')->where('id', $id)->first();
        $this->assertNotNull($row);

        // The real columns carry the values; starts_at/ends_at landed on
        // start_date/end_date instead of being dropped on the floor.
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame('listing_created', $row->action_type);
        $this->assertSame('weekly', $row->challenge_type);
        $this->assertSame(1, (int) $row->is_active);
        $this->assertSame(now()->subDay()->toDateString(), (string) $row->start_date);
        $this->assertSame(now()->addDays(3)->toDateString(), (string) $row->end_date);
        $this->assertSame(3, (int) $row->target_count);
        $this->assertSame(40, (int) $row->xp_reward);

        // And none of the four phantom keys became a column.
        foreach (['status', 'category', 'starts_at', 'ends_at'] as $phantom) {
            $this->assertObjectNotHasProperty(
                $phantom,
                $row,
                "challenges.$phantom does not exist in the schema — it must not be written"
            );
        }
    }

    public function test_created_challenge_is_visible_to_the_live_read_path(): void
    {
        // The strongest check available: a row created by create() must satisfy
        // the is_active + start_date/end_date predicates that the only real
        // callers of this service (getChallengesWithProgress / updateProgress)
        // use. A row written with end_date = NULL/'0000-00-00' — the shape the
        // old defaults produced — would insert and then be permanently
        // unreachable.
        $userId = $this->makeUser('challengecreate');
        $id = ChallengeService::create($this->testTenantId, $this->phantomChallengePayload());

        $visible = collect(ChallengeService::getChallengesWithProgress($userId))
            ->firstWhere('id', $id);

        $this->assertNotNull($visible, 'created challenge is invisible to getChallengesWithProgress()');
        $this->assertSame(0, $visible['user_progress']);
        $this->assertFalse($visible['is_completed']);

        $this->assertContains(
            $id,
            collect(ChallengeService::getActiveChallenges())->pluck('id')->all()
        );
    }

    public function test_create_challenge_rejects_missing_not_null_columns(): void
    {
        // `action_type` is NOT NULL with no default. It used to default to null
        // here, so every single call threw 1048 from inside the driver.
        $payload = $this->phantomChallengePayload();
        unset($payload['action_type']);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/action_type/');
        ChallengeService::create($this->testTenantId, $payload);
    }

    public function test_create_challenge_rejects_missing_end_date(): void
    {
        // `end_date` is NOT NULL too, and getChallengesWithProgress() filters
        // on it, so an absent end date must be refused rather than persisted.
        $payload = $this->phantomChallengePayload();
        unset($payload['ends_at'], $payload['end_date']);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/end_date/');
        ChallengeService::create($this->testTenantId, $payload);
    }

    public function test_create_challenge_rejects_out_of_enum_challenge_type(): void
    {
        // challenge_type is enum('daily','weekly','monthly','special'). Under
        // the non-strict sql_mode this app runs, 'general' would have been
        // truncated to '' and persisted — the same silent-corruption mode the
        // FIX 3/4 enum bugs at the top of this file had.
        $this->expectException(\InvalidArgumentException::class);
        ChallengeService::create(
            $this->testTenantId,
            $this->phantomChallengePayload(['challenge_type' => 'general'])
        );

        $this->assertSame(
            0,
            DB::table('challenges')->where('challenge_type', '')->count(),
            'an out-of-enum challenge_type was truncated to empty string and persisted'
        );
    }

    public function test_get_all_status_filter_maps_onto_is_active(): void
    {
        $activeId = ChallengeService::create($this->testTenantId, $this->phantomChallengePayload());
        $inactiveId = ChallengeService::create(
            $this->testTenantId,
            $this->phantomChallengePayload(['title' => 'Retired', 'is_active' => false])
        );

        // Before the fix this threw 42S22 Unknown column 'status' on the
        // count() — getAll() has no catch, so this was an uncaught 500.
        $active = ChallengeService::getAll($this->testTenantId, ['status' => 'active', 'limit' => 100]);
        $activeIds = array_column($active['items'], 'id');

        $this->assertContains($activeId, $activeIds);
        $this->assertNotContains($inactiveId, $activeIds, 'the status alias did not actually filter');

        $inactive = ChallengeService::getAll($this->testTenantId, ['status' => 'inactive', 'limit' => 100]);
        $inactiveIds = array_column($inactive['items'], 'id');

        $this->assertContains($inactiveId, $inactiveIds);
        $this->assertNotContains($activeId, $inactiveIds);
    }

    public function test_get_all_filters_on_challenge_type_not_phantom_category(): void
    {
        $weeklyId = ChallengeService::create($this->testTenantId, $this->phantomChallengePayload());
        $dailyId = ChallengeService::create(
            $this->testTenantId,
            $this->phantomChallengePayload(['title' => 'Daily one', 'challenge_type' => 'daily'])
        );

        // `category` never existed; challenge_type is the real taxonomy.
        $result = ChallengeService::getAll(
            $this->testTenantId,
            ['challenge_type' => 'daily', 'limit' => 100]
        );
        $ids = array_column($result['items'], 'id');

        $this->assertContains($dailyId, $ids);
        $this->assertNotContains($weeklyId, $ids);
    }

    public function test_get_all_is_scoped_to_the_requested_tenant(): void
    {
        $id = ChallengeService::create($this->testTenantId, $this->phantomChallengePayload());

        // The $tenantId argument used to be decorative — the result depended
        // entirely on ambient TenantContext.
        $result = ChallengeService::getAll($this->testTenantId + 9999, ['limit' => 100]);

        $this->assertNotContains($id, array_column($result['items'], 'id'));
        $this->assertSame(0, $result['total']);
    }

    // =====================================================================
    // 2026-08-04 — super_admin_audit_log.action_type vs SuperAdminAuditService
    // =====================================================================

    /**
     * The enum shipped without 'tenant_purged', so every permanent tenant purge
     * was audited with action_type = '' — the write succeeded, log() returned
     * true, and the entry became invisible to the audit log's action filter.
     * 'global_super_admin_granted' / '_revoked' had the same gap.
     *
     * Sibling to Tests\Laravel\Unit\Database\SuperAdminAuditActionTypeContractTest,
     * which pins the same contract against the committed schema dump with no
     * database. This one proves THIS database has actually been migrated — the
     * failure the dump-based test cannot see.
     */
    public function test_every_audit_action_type_round_trips_through_the_real_enum(): void
    {
        foreach (SuperAdminAuditService::actionTypes() as $type) {
            $marker = 'enum contract ' . uniqid('', true);

            $this->assertTrue(
                SuperAdminAuditService::log($type, 'tenant', $this->testTenantId, $marker),
                "log() reported action_type '{$type}' was not recorded faithfully."
            );

            $stored = DB::table('super_admin_audit_log')
                ->where('target_name', $marker)
                ->orderByDesc('id')
                ->value('action_type');

            $this->assertSame(
                $type,
                $stored,
                "action_type '{$type}' was stored as '" . (string) $stored . "'. An empty string means this "
                . 'database is missing the enum member — run: docker exec -e DB_DATABASE=nexus_test '
                . 'nexus-php-app php artisan migrate --force'
            );
        }
    }

    /**
     * An unknown action type must still produce a row — losing the actor, target,
     * old/new values and description to protect one field would be a worse trade —
     * but it must be flagged, and stored under the queryable sentinel rather than
     * the '' that MariaDB would otherwise coerce it to.
     */
    public function test_unknown_action_type_is_recorded_under_the_sentinel_and_reported(): void
    {
        $marker = 'enum sentinel ' . uniqid('', true);

        $this->assertFalse(
            SuperAdminAuditService::log('not_a_real_action_type', 'tenant', $this->testTenantId, $marker),
            'log() must report an unknown action type as not faithfully recorded.'
        );

        $row = DB::table('super_admin_audit_log')->where('target_name', $marker)->first();

        $this->assertNotNull($row, 'the row must still be written — fail open, not closed');
        $this->assertSame(SuperAdminAuditService::UNKNOWN_ACTION, $row->action_type);
        $this->assertNotSame('', $row->action_type, 'must never store the empty-string coercion');
    }
}
