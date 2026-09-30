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
 * F-372 (E-065) — four live endpoints answered invalid input with HTTP 500, one
 * of them member-facing.
 *
 * `BaseApiController::respondWithError()` declares `$field` as `?string`. Four
 * call sites passed `$validator->errors()->toArray()` — an array — into it under
 * `declare(strict_types=1)`, which is a `TypeError`, not a 422:
 *
 *   MunicipalSurveyController::submitSurvey()      (member-facing)
 *   MunicipalSurveyController::adminCreateSurvey()
 *   MunicipalSurveyController::adminUpdateSurvey()
 *   EmergencyAlertController::store()
 *
 * Adapted from the E-065 slice-J reproduction
 * `.local-docs-archive/security-log/E-065/repro/j/ValidationErrorFieldTypeTest.php`,
 * which asserted the BAD outcome (it expected the 500). The attack assertion is
 * inverted and the three untested call sites are covered here too.
 */
final class F372ValidationErrorFieldTypeTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $memberId = 0;
    private int $adminId = 0;
    private int $surveyId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->enableCaringCommunity();
        TenantContext::setById(self::TENANT);

        $this->memberId = $this->makeUser('f372.responder', 'member');
        $this->adminId = $this->makeUser('f372.admin', 'admin', isAdmin: true);

        $this->surveyId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id' => self::TENANT,
            'created_by' => $this->adminId,
            'title' => 'F372 survey ' . bin2hex(random_bytes(4)),
            'description' => 'F372 fixture',
            'status' => 'active',
            'is_anonymous' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * MEMBER-FACING: a survey response with the `answers` field missing must be
     * a validation error, not a server error.
     */
    public function test_member_survey_response_without_answers_is_a_validation_error(): void
    {
        Sanctum::actingAs(User::find($this->memberId));

        $response = $this->postJson(
            '/api/v2/caring-community/surveys/' . $this->surveyId . '/respond',
            [],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $response->getStatusCode(),
            'BAD OUTCOME: a member-facing endpoint answered invalid input with '
            . $response->getStatusCode() . '. Body: ' . substr($response->getContent(), 0, 400)
        );
        $this->assertStringNotContainsString('TypeError', $response->getContent());
        $this->assertSame('answers', $response->json('errors.0.field'));
    }

    /**
     * `adminCreateSurvey()` — same call site, admin side.
     */
    public function test_admin_survey_creation_without_a_title_is_a_validation_error(): void
    {
        Sanctum::actingAs(User::find($this->adminId));

        $response = $this->postJson(
            '/api/v2/admin/caring-community/surveys',
            ['description' => 'no title'],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $response->getStatusCode(),
            'BAD OUTCOME: body ' . substr($response->getContent(), 0, 400)
        );
        $this->assertStringNotContainsString('TypeError', $response->getContent());
        $this->assertSame('title', $response->json('errors.0.field'));
    }

    /**
     * `adminUpdateSurvey()` — same call site, on a draft survey.
     */
    public function test_admin_survey_update_with_an_invalid_question_is_a_validation_error(): void
    {
        $draftId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id' => self::TENANT,
            'created_by' => $this->adminId,
            'title' => 'F372 draft ' . bin2hex(random_bytes(4)),
            'status' => 'draft',
            'is_anonymous' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs(User::find($this->adminId));

        $response = $this->putJson(
            '/api/v2/admin/caring-community/surveys/' . $draftId,
            ['questions' => [['question_text' => 'ok', 'question_type' => 'not_a_type']]],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $response->getStatusCode(),
            'BAD OUTCOME: body ' . substr($response->getContent(), 0, 400)
        );
        $this->assertStringNotContainsString('TypeError', $response->getContent());
    }

    /**
     * `EmergencyAlertController::store()` — the fourth call site.
     */
    public function test_emergency_alert_creation_without_a_title_is_a_validation_error(): void
    {
        Sanctum::actingAs(User::find($this->adminId));

        $response = $this->postJson(
            '/api/v2/admin/caring-community/emergency-alerts',
            ['severity' => 'info'],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $response->getStatusCode(),
            'BAD OUTCOME: body ' . substr($response->getContent(), 0, 400)
        );
        $this->assertStringNotContainsString('TypeError', $response->getContent());
        $this->assertSame('title', $response->json('errors.0.field'));
    }

    /**
     * CONTROL — a well-formed member response is handled normally. Only the
     * validity of the body differs.
     */
    public function test_control_member_survey_response_with_answers_is_not_a_server_error(): void
    {
        Sanctum::actingAs(User::find($this->memberId));

        $response = $this->postJson(
            '/api/v2/caring-community/surveys/' . $this->surveyId . '/respond',
            ['answers' => [['question_id' => 1, 'answer_text' => 'fine']]],
            $this->withTenantHeader()
        );

        $this->assertLessThan(
            500,
            $response->getStatusCode(),
            'CONTROL: a well-formed body must not be a server error. Body: '
            . substr($response->getContent(), 0, 400)
        );
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function makeUser(string $prefix, string $role, bool $isAdmin = false): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F372 User',
            'first_name' => 'F372',
            'last_name' => 'User',
            'email' => $email,
            'username' => 'f372_' . substr(md5($email), 0, 10),
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
