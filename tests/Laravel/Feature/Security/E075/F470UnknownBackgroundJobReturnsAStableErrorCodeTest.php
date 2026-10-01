<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Http\Controllers\Api\AdminConfigController;
use App\Jobs\RunAdminCronJob;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * E-075 F-470 — POST /v2/admin/background-jobs/{id}/run names an unknown job
 * with a stable machine error code, not by echoing the caller's own text.
 *
 * `AdminConfigController::runJob()` called
 *
 *     $this->respondWithError('Unknown job: ' . $id, 400);
 *
 * against the four-parameter signature
 *
 *     respondWithError(string $code, string $message, ?string $field, int $status)
 *
 * at `BaseApiController:130`. So the caller-supplied path segment landed in the
 * machine-readable `code` field and the literal `400` landed in the
 * human-readable `message`. The file has no `declare(strict_types=1)`, so PHP
 * coerced the int to a string silently and nothing ever surfaced it.
 *
 * Low severity: the route is platform-super-admin only, the response is JSON so
 * there is no HTML context, and the status is 400 either way. The defect is that
 * an API client reading `errors[0].code` cannot branch on it, and the message it
 * shows a human is the number 400.
 *
 * 🔴 Separate, unfixed observation recorded here because it dictates the shape of
 * these tests: `routes/api.php:10` declares `Route::pattern('id', '[0-9]+')`,
 * which applies to every `{id}` segment in that file. The three job ids this
 * endpoint accepts — `digest_emails`, `badge_checker`, `streak_updater` — are
 * not numeric, so the SUCCESS arm of this route cannot be reached over HTTP at
 * all; it 404s before the controller runs. Only a numeric id reaches the
 * controller, and every numeric id is an unknown job. That is a defect in its
 * own right and is NOT fixed here (it is outside E-076 agent M's assigned
 * findings). The consequence for these tests: the harm case is exercised over
 * the real HTTP route with a numeric id, and the success control is exercised by
 * calling the controller action directly, which is the only way to reach it.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * Controls in the same file: the known job id still dispatches and still returns
 * 200, and an ordinary administrator is still refused — so a fix that simply
 * refused everything, or that loosened the authorisation, would fail here.
 */
final class F470UnknownBackgroundJobReturnsAStableErrorCodeTest extends TestCase
{
    use DatabaseTransactions;

    /** Numeric, so it survives `Route::pattern('id', '[0-9]+')`, and unknown. */
    private const UNKNOWN_NUMERIC_JOB_ID = '470470';

    private const UNKNOWN_TEXT_JOB_ID = 'f470-not-a-real-job';

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->superAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'role' => 'super_admin',
            'is_super_admin' => 1,
            'is_tenant_super_admin' => 0,
        ]);

        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $this->superAdmin->id,
                $this->superAdmin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);
    }

    // ------------------------------------------------------------------
    //  HARM — the error code must be a code, and the message must be a message
    // ------------------------------------------------------------------

    public function test_an_unknown_job_id_is_refused_over_http_with_a_stable_machine_code(): void
    {
        Queue::fake();

        $response = $this->apiPost(
            '/v2/admin/background-jobs/' . self::UNKNOWN_NUMERIC_JOB_ID . '/run'
        );

        $response->assertStatus(400);

        $this->assertErrorIsWellFormed(
            (string) $response->json('errors.0.code'),
            (string) $response->json('errors.0.message'),
            self::UNKNOWN_NUMERIC_JOB_ID,
        );

        $response->assertJsonPath('errors.0.field', 'id');

        Queue::assertNotPushed(RunAdminCronJob::class);
    }

    public function test_an_unknown_job_name_is_refused_with_a_stable_machine_code(): void
    {
        Queue::fake();
        $this->actingAs($this->superAdmin);

        $payload = $this->decode(
            app(AdminConfigController::class)->runJob(self::UNKNOWN_TEXT_JOB_ID)
        );

        $this->assertErrorIsWellFormed(
            (string) ($payload['errors'][0]['code'] ?? ''),
            (string) ($payload['errors'][0]['message'] ?? ''),
            self::UNKNOWN_TEXT_JOB_ID,
        );

        Queue::assertNotPushed(RunAdminCronJob::class);
    }

    // ------------------------------------------------------------------
    //  CONTROLS
    // ------------------------------------------------------------------

    public function test_control_a_known_job_id_is_still_dispatched(): void
    {
        Queue::fake();
        $this->actingAs($this->superAdmin);

        $response = app(AdminConfigController::class)->runJob('digest_emails');
        $payload = $this->decode($response);

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'CONTROL: the rightful actor triggering a real job still succeeds.',
        );
        $this->assertTrue($payload['data']['triggered'] ?? false);
        $this->assertSame('digest_emails', $payload['data']['job'] ?? null);

        Queue::assertPushed(RunAdminCronJob::class, 1);
    }

    public function test_control_an_ordinary_administrator_is_still_refused(): void
    {
        Queue::fake();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $admin->id,
                $admin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);

        $this->apiPost('/v2/admin/background-jobs/' . self::UNKNOWN_NUMERIC_JOB_ID . '/run')
            ->assertStatus(403);

        Queue::assertNotPushed(RunAdminCronJob::class);
    }

    // ------------------------------------------------------------------

    private function assertErrorIsWellFormed(string $code, string $message, string $jobId): void
    {
        $this->assertSame(
            'VALIDATION_ERROR',
            $code,
            'F-470: the error code must be a stable machine code an API client can branch on.',
        );
        $this->assertStringNotContainsString(
            $jobId,
            $code,
            'F-470: the caller\'s own path segment must not become the machine error code.',
        );
        $this->assertNotSame(
            '400',
            $message,
            'F-470: the human-readable message must not be the HTTP status number.',
        );
        $this->assertNotSame(
            '',
            trim($message),
            'F-470: there must be a human-readable message.',
        );
        $this->assertFalse(
            is_numeric($message),
            'F-470: a bare number is not a message — the arguments were transposed.',
        );
    }

    /** @return array<string,mixed> */
    private function decode(\Illuminate\Http\JsonResponse $response): array
    {
        return (array) json_decode((string) $response->getContent(), true);
    }
}
