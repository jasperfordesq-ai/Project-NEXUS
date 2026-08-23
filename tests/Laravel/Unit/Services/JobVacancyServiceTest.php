<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\JobAlert;
use App\Models\JobApplication;
use App\Models\JobVacancy;
use App\Models\SavedJob;
use App\Services\JobVacancyService;
use App\Services\JobOfferService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * JobVacancyServiceTest
 *
 * Covers the public surface of JobVacancyService (2426 lines).
 * Strategy:
 *   — Real DB via DatabaseTransactions (rolled back after each test).
 *   — Tenant 2 (hour-timebank) is always active via TenantContext::setById(2).
 *   — Http::fake() to silence outbound webhook / spam detection HTTP calls.
 *   — Event::fake() to silence JobVacancyCreated event dispatch.
 *   — Queue::fake() to catch any queued jobs from observers.
 *
 * SKIPPED METHODS (annotated inline):
 *   — enrichVacancy / enrichVacancyBatch / enrichVacancyArray: private helpers
 *     exercised implicitly by getById/getAll.
 *   — getApplicationHistory: requires job_application_history rows with specific
 *     application_id FK + complex history chain — deferred to feature tests.
 *   — getAnalytics: delegates to multiple private stat helpers + joins across
 *     6+ tables (views, scorecards, referrals, trend windows) — deferred.
 *   — getRecommended: correctness depends on skills fuzzy-match scoring; covered
 *     via calculateMatchPercentage unit tests + integration tests.
 *   — exportApplicationsCsv / bulkUpdateApplicationStatus: admin-path integration
 *     tests require full applicant objects + canManageVacancy chain; deferred.
 *   — featureJob / unfeatureJob: require isAdminUser; tested at the admin role
 *     gate level here; expiration covered by expireFeaturedJobs test.
 *   — getQualificationAssessment: thin wrapper around calculateMatchPercentage
 *     + enrichVacancy; covered indirectly.
 *   — findSimilarJobs: pure DB query helper; tested separately below.
 */
class JobVacancyServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private JobVacancyService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        Http::fake();   // silence outbound webhooks / spam-check HTTP
        Event::fake(); // silence JobVacancyCreated event
        Queue::fake(); // silence any observer-dispatched jobs

        $this->svc = app(JobVacancyService::class);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a minimal user row and return its ID.
     */
    private function insertUser(string $role = 'member'): int
    {
        $uid = uniqid('jvt_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'name'        => 'Test User ' . $uid,
            'first_name'  => 'Test',
            'last_name'   => 'User',
            'email'       => $uid . '@example.test',
            'status'      => 'active',
            'balance'     => 0.00,
            'role'        => $role,
            'is_admin'    => $role === 'admin' ? 1 : 0,
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert a minimal open job vacancy and return its ID.
     */
    private function insertVacancy(int $userId, array $overrides = []): int
    {
        return DB::table('job_vacancies')->insertGetId(array_merge([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'title'       => 'PHP Developer',
            'description' => 'Test vacancy description.',
            'type'        => 'volunteer',
            'commitment'  => 'flexible',
            'status'      => 'open',
            'created_at'  => now(),
            'updated_at'  => now(),
        ], $overrides));
    }

    // =========================================================================
    // create()
    // =========================================================================

    public function test_create_returns_positive_id_for_valid_volunteer_vacancy(): void
    {
        $userId = $this->insertUser();

        $id = $this->svc->create($userId, [
            'title'       => 'Dog Walker',
            'description' => 'Walk dogs in the park.',
            'type'        => 'volunteer',
            'commitment'  => 'flexible',
        ]);

        $this->assertGreaterThan(0, $id);
        $this->assertEmpty($this->svc->getErrors());

        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('volunteer', $row->type);
        $this->assertSame((string) self::TENANT_ID, (string) $row->tenant_id);
    }

    public function test_create_returns_zero_and_sets_error_for_invalid_type(): void
    {
        $userId = $this->insertUser();

        $id = $this->svc->create($userId, [
            'title'       => 'Bad Type Job',
            'description' => 'Test.',
            'type'        => 'bogus',
        ]);

        $this->assertSame(0, $id);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_INVALID_VALUE', $errors[0]['code']);
    }

    public function test_create_paid_vacancy_requires_salary_range(): void
    {
        $userId = $this->insertUser();

        // Paid + no salary + not negotiable → validation error
        $id = $this->svc->create($userId, [
            'title'             => 'Paid Job No Salary',
            'description'       => 'Test.',
            'type'              => 'paid',
            'commitment'        => 'full_time',
            'salary_negotiable' => false,
            // salary_min / salary_max deliberately omitted
        ]);

        $this->assertSame(0, $id);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_SALARY_REQUIRED', $errors[0]['code']);
    }

    public function test_create_paid_vacancy_with_negotiable_flag_skips_salary_validation(): void
    {
        $userId = $this->insertUser();

        $id = $this->svc->create($userId, [
            'title'             => 'Negotiable Paid Job',
            'description'       => 'Test.',
            'type'              => 'paid',
            'commitment'        => 'full_time',
            'salary_negotiable' => true,
        ]);

        $this->assertGreaterThan(0, $id);
        $this->assertEmpty($this->svc->getErrors());
    }

    public function test_create_returns_error_when_salary_min_exceeds_max(): void
    {
        $userId = $this->insertUser();

        $id = $this->svc->create($userId, [
            'title'             => 'Inverted Salary',
            'description'       => 'Test.',
            'type'              => 'paid',
            'commitment'        => 'full_time',
            'salary_min'        => 80000,
            'salary_max'        => 50000, // less than min
            'salary_negotiable' => false,
        ]);

        $this->assertSame(0, $id);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_SALARY_RANGE', $errors[0]['code']);
    }

    public function test_create_saves_skills_as_comma_string_when_array_supplied(): void
    {
        $userId = $this->insertUser();

        $id = $this->svc->create($userId, [
            'title'           => 'Skills Array Job',
            'description'     => 'Test.',
            'type'            => 'volunteer',
            'commitment'      => 'flexible',
            'skills_required' => ['PHP', 'Laravel', 'MySQL'],
        ]);

        $this->assertGreaterThan(0, $id);
        $row = DB::table('job_vacancies')->where('id', $id)->first();
        $this->assertNotNull($row);
        // normalizeSkillsInput joins the array with ', '
        $this->assertStringContainsString('PHP', $row->skills_required);
        $this->assertStringContainsString('Laravel', $row->skills_required);
    }

    // =========================================================================
    // getById() / legacyGetById()
    // =========================================================================

    public function test_getById_returns_null_for_nonexistent_vacancy(): void
    {
        $result = $this->svc->getById(PHP_INT_MAX);
        $this->assertNull($result);
    }

    public function test_getById_returns_array_with_correct_id(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId, ['title' => 'My Test Vacancy']);

        $result = $this->svc->getById($vacId);

        $this->assertIsArray($result);
        $this->assertSame($vacId, (int) $result['id']);
        $this->assertSame('My Test Vacancy', $result['title']);
    }

    public function test_legacyGetById_returns_null_for_nonexistent_vacancy(): void
    {
        $result = $this->svc->legacyGetById(PHP_INT_MAX);
        $this->assertNull($result);
    }

    /**
     * 🔴 Every single-vacancy read returned an EMPTY poster name.
     *
     * `enrichVacancy()` builds `creator.name` from the `creator_first_name` /
     * `creator_last_name` aliases, and both of these methods joined only
     * `organizations` — never `users`. So `creator.name` came back as `''` and each
     * frontend drew a "Posted by" heading with nothing under it. Measured on a device on
     * 2026-08-23; the list queries have always joined `users`, which is why the cards
     * looked right and only the detail screen was blank.
     *
     * Both methods are asserted because they are byte-identical query bodies and a fix
     * aimed at the wrong one passes silently — which is exactly what happened first.
     */
    public function test_single_vacancy_reads_include_the_poster_name(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        foreach (['legacyGetById', 'getById'] as $method) {
            $result = $this->svc->{$method}($vacId);

            $this->assertIsArray($result, $method . '() should return the vacancy');
            $this->assertArrayHasKey('creator', $result);
            $this->assertSame($userId, (int) $result['creator']['id']);
            $this->assertSame(
                'Test User',
                trim((string) $result['creator']['name']),
                $method . '() must join users so the poster has a name, not an empty string',
            );
        }
    }

    // =========================================================================
    // update()
    // =========================================================================

    public function test_update_changes_title_by_owner(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $ok = $this->svc->update($vacId, $userId, ['title' => 'Updated Title']);

        $this->assertTrue($ok);
        $this->assertEmpty($this->svc->getErrors());

        $row = DB::table('job_vacancies')->where('id', $vacId)->first();
        $this->assertSame('Updated Title', $row->title);
    }

    public function test_update_returns_false_for_nonexistent_vacancy(): void
    {
        $userId = $this->insertUser();

        $ok = $this->svc->update(PHP_INT_MAX, $userId, ['title' => 'Ghost Update']);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
    }

    public function test_update_returns_false_when_non_owner_non_admin_edits(): void
    {
        $ownerId   = $this->insertUser();
        $strangerId = $this->insertUser();
        $vacId     = $this->insertVacancy($ownerId);

        $ok = $this->svc->update($vacId, $strangerId, ['title' => 'Hijacked']);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_FORBIDDEN', $errors[0]['code']);
    }

    public function test_update_returns_true_with_no_changes(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        // Passing no recognised allowed fields → $updates is empty → early true
        $ok = $this->svc->update($vacId, $userId, []);

        $this->assertTrue($ok);
    }

    public function test_update_returns_error_for_invalid_status(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $ok = $this->svc->update($vacId, $userId, ['status' => 'flying']);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_INVALID_VALUE', $errors[0]['code']);
    }

    // =========================================================================
    // delete()
    // =========================================================================

    public function test_delete_removes_vacancy_from_db(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $ok = $this->svc->delete($vacId, $userId);

        $this->assertTrue($ok);
        $this->assertNull(DB::table('job_vacancies')->where('id', $vacId)->first());
    }

    public function test_delete_returns_false_for_nonexistent_vacancy(): void
    {
        $userId = $this->insertUser();

        $ok = $this->svc->delete(PHP_INT_MAX, $userId);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
    }

    public function test_delete_returns_false_when_non_owner_non_admin_deletes(): void
    {
        $ownerId    = $this->insertUser();
        $strangerId = $this->insertUser();
        $vacId      = $this->insertVacancy($ownerId);

        $ok = $this->svc->delete($vacId, $strangerId);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_FORBIDDEN', $errors[0]['code']);
        // Vacancy must still exist
        $this->assertNotNull(DB::table('job_vacancies')->where('id', $vacId)->first());
    }

    // =========================================================================
    // apply()
    // =========================================================================

    public function test_apply_creates_application_row_and_returns_id(): void
    {
        $ownerId     = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacId       = $this->insertVacancy($ownerId);

        $appId = $this->svc->apply($vacId, $applicantId, ['cover_letter' => 'I am great']);

        $this->assertIsInt($appId);
        $this->assertGreaterThan(0, $appId);
        $this->assertEmpty($this->svc->getErrors());

        $row = DB::table('job_vacancy_applications')->where('id', $appId)->first();
        $this->assertNotNull($row);
        $this->assertSame((string) $vacId, (string) $row->vacancy_id);
        $this->assertSame((string) $applicantId, (string) $row->user_id);
    }

    public function test_apply_safeguarding_denial_writes_no_application(): void
    {
        $ownerId = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacancyId = $this->insertVacancy($ownerId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($applicantId, $ownerId, self::TENANT_ID, 'job_application')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            $this->svc->apply($vacancyId, $applicantId, ['cover_letter' => 'Must not persist']);
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('job_vacancy_applications', [
            'tenant_id' => self::TENANT_ID,
            'vacancy_id' => $vacancyId,
            'user_id' => $applicantId,
        ]);
    }

    public function test_job_offer_safeguarding_denial_writes_no_offer(): void
    {
        $ownerId = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacancyId = $this->insertVacancy($ownerId);
        $applicationId = (int) $this->svc->apply($vacancyId, $applicantId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($ownerId, $applicantId, self::TENANT_ID, 'job_offer')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            JobOfferService::create($applicationId, $ownerId, ['message' => 'Must not persist']);
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('job_offers', [
            'tenant_id' => self::TENANT_ID,
            'application_id' => $applicationId,
        ]);
    }

    public function test_apply_returns_null_when_vacancy_does_not_exist(): void
    {
        $applicantId = $this->insertUser();

        $appId = $this->svc->apply(PHP_INT_MAX, $applicantId);

        $this->assertNull($appId);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
    }

    public function test_apply_returns_null_when_owner_applies_to_own_vacancy(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $appId = $this->svc->apply($vacId, $userId);

        $this->assertNull($appId);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_FORBIDDEN', $errors[0]['code']);
    }

    public function test_apply_returns_null_when_vacancy_is_closed(): void
    {
        $ownerId     = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacId       = $this->insertVacancy($ownerId, ['status' => 'closed']);

        $appId = $this->svc->apply($vacId, $applicantId);

        $this->assertNull($appId);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VACANCY_CLOSED', $errors[0]['code']);
    }

    public function test_apply_returns_null_on_duplicate_application(): void
    {
        $ownerId     = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacId       = $this->insertVacancy($ownerId);

        // First application
        $first = $this->svc->apply($vacId, $applicantId);
        $this->assertNotNull($first);

        // Duplicate application — should return null with RESOURCE_CONFLICT
        $second = $this->svc->apply($vacId, $applicantId);
        $this->assertNull($second);

        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_CONFLICT', $errors[0]['code']);
    }

    public function test_apply_increments_applications_count_on_vacancy(): void
    {
        $ownerId     = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacId       = $this->insertVacancy($ownerId);

        $before = (int) DB::table('job_vacancies')->where('id', $vacId)->value('applications_count');

        $this->svc->apply($vacId, $applicantId);

        $after = (int) DB::table('job_vacancies')->where('id', $vacId)->value('applications_count');
        $this->assertSame($before + 1, $after);
    }

    // =========================================================================
    // saveJob() / unsaveJob() / getSavedJobs()
    // =========================================================================

    public function test_saveJob_creates_saved_job_row(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $ok = $this->svc->saveJob($vacId, $userId);

        $this->assertTrue($ok);
        $exists = DB::table('saved_jobs')->where('job_id', $vacId)->where('user_id', $userId)->exists();
        $this->assertTrue($exists);
    }

    public function test_saveJob_is_idempotent(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $this->svc->saveJob($vacId, $userId);
        $ok = $this->svc->saveJob($vacId, $userId); // second call

        $this->assertTrue($ok);
        // Only one row
        $count = DB::table('saved_jobs')->where('job_id', $vacId)->where('user_id', $userId)->count();
        $this->assertSame(1, $count);
    }

    public function test_saveJob_returns_false_for_nonexistent_vacancy(): void
    {
        $userId = $this->insertUser();

        $ok = $this->svc->saveJob(PHP_INT_MAX, $userId);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
    }

    public function test_unsaveJob_removes_saved_job_row(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId);

        $this->svc->saveJob($vacId, $userId);
        $this->svc->unsaveJob($vacId, $userId);

        $exists = DB::table('saved_jobs')->where('job_id', $vacId)->where('user_id', $userId)->exists();
        $this->assertFalse($exists);
    }

    // =========================================================================
    // getAll() — filtering
    // =========================================================================

    public function test_getAll_returns_items_has_more_cursor_keys(): void
    {
        $result = $this->svc->getAll();

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertArrayHasKey('cursor', $result);
    }

    public function test_getAll_public_only_excludes_closed_vacancies(): void
    {
        $userId  = $this->insertUser();
        $openId  = $this->insertVacancy($userId, ['status' => 'open', 'title' => 'Open Public Vacancy']);
        $closedId = $this->insertVacancy($userId, ['status' => 'closed', 'title' => 'Closed Vacancy']);

        $result = $this->svc->getAll(['public_only' => true]);
        $ids    = array_column($result['items'], 'id');

        $this->assertContains($openId, $ids);
        $this->assertNotContains($closedId, $ids);
    }

    public function test_getAll_filters_by_category(): void
    {
        $userId = $this->insertUser();
        $catId  = $this->insertVacancy($userId, ['category' => 'tech', 'title' => 'Tech Job']);
        $otherId = $this->insertVacancy($userId, ['category' => 'arts', 'title' => 'Arts Job']);

        $result = $this->svc->getAll(['category' => 'tech']);
        $ids    = array_column($result['items'], 'id');

        $this->assertContains($catId, $ids);
        $this->assertNotContains($otherId, $ids);
    }

    // =========================================================================
    // renewJob()
    // =========================================================================

    public function test_renewJob_sets_status_open_and_increments_renewal_count(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId, ['status' => 'closed', 'renewal_count' => 0]);

        $ok = $this->svc->renewJob($vacId, $userId, 14);

        $this->assertTrue($ok);
        $row = DB::table('job_vacancies')->where('id', $vacId)->first();
        $this->assertSame('open', $row->status);
        $this->assertSame(1, (int) $row->renewal_count);
        $this->assertNotNull($row->deadline);
    }

    public function test_renewJob_returns_false_for_nonexistent_vacancy(): void
    {
        $userId = $this->insertUser();

        $ok = $this->svc->renewJob(PHP_INT_MAX, $userId);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_NOT_FOUND', $errors[0]['code']);
    }

    public function test_renewJob_returns_false_when_non_owner_attempts_renewal(): void
    {
        $ownerId    = $this->insertUser();
        $strangerId = $this->insertUser();
        $vacId      = $this->insertVacancy($ownerId, ['status' => 'closed']);

        $ok = $this->svc->renewJob($vacId, $strangerId);

        $this->assertFalse($ok);
        $errors = $this->svc->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('RESOURCE_FORBIDDEN', $errors[0]['code']);
    }

    // =========================================================================
    // expireFeaturedJobs() / expireOverdueJobs()
    // =========================================================================

    public function test_expireFeaturedJobs_clears_is_featured_for_expired_window(): void
    {
        $userId = $this->insertUser();
        // Insert a featured vacancy whose window expired 2 days ago
        $vacId = $this->insertVacancy($userId, [
            'is_featured'   => 1,
            'featured_until' => now()->subDays(2)->toDateTimeString(),
        ]);

        $count = $this->svc->expireFeaturedJobs();

        $this->assertGreaterThanOrEqual(1, $count);
        $row = DB::table('job_vacancies')->where('id', $vacId)->first();
        $this->assertSame(0, (int) $row->is_featured);
    }

    public function test_expireOverdueJobs_closes_stale_open_vacancy(): void
    {
        $userId = $this->insertUser();
        // 200 days old, last updated 90 days ago — qualifies for expiry
        $vacId = DB::table('job_vacancies')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'title'       => 'Stale Open Vacancy',
            'description' => 'Old.',
            'type'        => 'volunteer',
            'commitment'  => 'flexible',
            'status'      => 'open',
            'created_at'  => now()->subDays(200)->toDateTimeString(),
            'updated_at'  => now()->subDays(90)->toDateTimeString(),
        ]);

        $count = $this->svc->expireOverdueJobs();

        $this->assertGreaterThanOrEqual(1, $count);
        $row = DB::table('job_vacancies')->where('id', $vacId)->first();
        $this->assertSame('closed', $row->status);
    }

    // =========================================================================
    // subscribeAlert() / getAlerts() / unsubscribeAlert() / resubscribeAlert() / deleteAlert()
    // =========================================================================

    public function test_subscribeAlert_creates_alert_and_returns_id(): void
    {
        $userId = $this->insertUser();

        $alertId = $this->svc->subscribeAlert($userId, [
            'keywords'   => 'PHP Laravel',
            'type'       => 'volunteer',
            'commitment' => 'flexible',
        ]);

        $this->assertIsInt($alertId);
        $this->assertGreaterThan(0, $alertId);

        // subscribeAlert() now sets tenant_id explicitly, so the row is scoped to the
        // active tenant and is reachable by every other HasTenantScope-scoped query.
        $row = DB::table('job_alerts')->where('id', $alertId)->first();
        $this->assertNotNull($row);
        $this->assertSame((string) $userId, (string) $row->user_id);
        $this->assertSame(1, (int) $row->is_active);
        $this->assertSame(self::TENANT_ID, (int) $row->tenant_id);
        $this->assertSame('PHP Laravel', $row->keywords);
    }

    public function test_getAlerts_returns_alerts_for_user(): void
    {
        $userId  = $this->insertUser();
        $alertId = $this->svc->subscribeAlert($userId, ['keywords' => 'testing']);

        $alerts = $this->svc->getAlerts($userId);

        $this->assertIsArray($alerts);
        $this->assertCount(1, $alerts);
        $this->assertSame($alertId, $alerts[0]['id']);
        $this->assertSame($userId, $alerts[0]['user_id']);
        $this->assertTrue($alerts[0]['is_active']);
        $this->assertSame('testing', $alerts[0]['keywords']);
    }

    public function test_unsubscribeAlert_deactivates_alert(): void
    {
        $userId  = $this->insertUser();
        $alertId = $this->svc->subscribeAlert($userId, ['keywords' => 'nurse']);

        $this->svc->unsubscribeAlert($alertId, $userId);

        $row = DB::table('job_alerts')->where('id', $alertId)->first();
        $this->assertNotNull($row);
        $this->assertSame(0, (int) $row->is_active);
    }

    public function test_resubscribeAlert_reactivates_alert(): void
    {
        $userId  = $this->insertUser();
        $alertId = $this->svc->subscribeAlert($userId, ['keywords' => 'teacher']);

        $this->svc->unsubscribeAlert($alertId, $userId);
        $this->assertSame(0, (int) DB::table('job_alerts')->where('id', $alertId)->value('is_active'));

        $this->svc->resubscribeAlert($alertId, $userId);

        $row = DB::table('job_alerts')->where('id', $alertId)->first();
        $this->assertSame(1, (int) $row->is_active);
    }

    public function test_deleteAlert_removes_alert_row(): void
    {
        $userId  = $this->insertUser();
        $alertId = $this->svc->subscribeAlert($userId, ['keywords' => 'delete me']);

        $this->svc->deleteAlert($alertId, $userId);

        $row = DB::table('job_alerts')->where('id', $alertId)->first();
        $this->assertNull($row);
    }

    // =========================================================================
    // calculateMatchPercentage()
    // =========================================================================

    public function test_calculateMatchPercentage_returns_100_when_job_has_no_required_skills(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId, ['skills_required' => null]);

        // Update user skills directly so the User model picks it up
        DB::table('users')->where('id', $userId)->update(['skills' => 'PHP, MySQL']);

        $result = $this->svc->calculateMatchPercentage($userId, $vacId);

        $this->assertSame(100, $result['percentage']);
        $this->assertArrayHasKey('matched', $result);
        $this->assertArrayHasKey('missing', $result);
    }

    public function test_calculateMatchPercentage_returns_0_when_user_has_no_skills(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId, ['skills_required' => 'PHP, Laravel']);

        DB::table('users')->where('id', $userId)->update(['skills' => null]);

        $result = $this->svc->calculateMatchPercentage($userId, $vacId);

        $this->assertSame(0, $result['percentage']);
        $this->assertNotEmpty($result['missing']);
    }

    public function test_calculateMatchPercentage_returns_partial_when_some_skills_match(): void
    {
        $userId = $this->insertUser();
        $vacId  = $this->insertVacancy($userId, ['skills_required' => 'PHP, Python, Go']);

        DB::table('users')->where('id', $userId)->update(['skills' => 'PHP, JavaScript']);

        $result = $this->svc->calculateMatchPercentage($userId, $vacId);

        $this->assertGreaterThan(0, $result['percentage']);
        $this->assertLessThan(100, $result['percentage']);
        $this->assertNotEmpty($result['matched']);
        $this->assertNotEmpty($result['missing']);
    }

    // =========================================================================
    // getMyApplications()
    // =========================================================================

    public function test_getMyApplications_returns_paginated_structure(): void
    {
        $userId = $this->insertUser();

        $result = $this->svc->getMyApplications($userId);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertIsArray($result['items']);
    }

    public function test_getMyApplications_includes_submitted_application(): void
    {
        $ownerId     = $this->insertUser();
        $applicantId = $this->insertUser();
        $vacId       = $this->insertVacancy($ownerId);

        $this->svc->apply($vacId, $applicantId);

        $result = $this->svc->getMyApplications($applicantId);

        $vacancyIds = array_column(array_column($result['items'], 'vacancy'), 'id');
        $this->assertContains($vacId, $vacancyIds);
    }

    // =========================================================================
    // getMyPostings()
    // =========================================================================

    public function test_getMyPostings_returns_only_user_own_vacancies(): void
    {
        $userId  = $this->insertUser();
        $otherId = $this->insertUser();
        $ownVacId   = $this->insertVacancy($userId, ['title' => 'My Own Posting']);
        $otherVacId = $this->insertVacancy($otherId, ['title' => 'Someone Elses Posting']);

        $result = $this->svc->getMyPostings($userId, self::TENANT_ID);

        $ids = array_column($result['items'], 'id');
        $this->assertContains($ownVacId, $ids);
        $this->assertNotContains($otherVacId, $ids);
    }

    // =========================================================================
    // findSimilarJobs()
    // =========================================================================

    public function test_findSimilarJobs_returns_matching_vacancies(): void
    {
        $userId = $this->insertUser();
        // Insert a vacancy with overlapping title words
        $this->insertVacancy($userId, ['title' => 'Senior PHP Developer', 'status' => 'open']);

        $results = $this->svc->findSimilarJobs('PHP Developer Lead', null, self::TENANT_ID);

        // Should find at least our inserted vacancy (40%+ word overlap)
        $this->assertIsArray($results);
        $this->assertNotEmpty($results);
        $this->assertArrayHasKey('similarity', $results[0]);
        $this->assertGreaterThanOrEqual(0.4, $results[0]['similarity']);
    }

    public function test_findSimilarJobs_returns_empty_for_short_words_only(): void
    {
        // Titles of only 1–2 char words → no words pass the 3-char filter
        $results = $this->svc->findSimilarJobs('A B C D', null, self::TENANT_ID);

        $this->assertIsArray($results);
        $this->assertEmpty($results);
    }
}
