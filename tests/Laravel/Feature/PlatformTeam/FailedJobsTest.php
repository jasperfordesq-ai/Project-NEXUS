<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Failed background jobs.
 *
 * Laravel records every background job that failed in `failed_jobs`; until
 * this page nothing showed them. The page lists them and lets the platform
 * team run one again or discard it.
 *
 * 🔴 A failed job's payload and exception can hold members' details (the
 * recipient of an email, a name in an error message). The list sends the job's
 * name, its queue, when it failed, and ONE line of the reason with email
 * addresses masked. It never sends the payload or the stack trace.
 */
class FailedJobsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const LIST = '/v2/platform-team/failed-jobs';

    private function plant(array $overrides = []): string
    {
        $uuid = (string) Str::uuid();
        DB::table('failed_jobs')->insert(array_merge([
            'uuid' => $uuid,
            'connection' => 'redis',
            'queue' => 'default',
            'payload' => json_encode([
                'displayName' => 'App\\Jobs\\SendWelcomeEmail',
                'data' => ['command' => 'serialized: secret.member@example.test, Mary Surname'],
            ]),
            'exception' => "RuntimeException: Mailbox secret.member@example.test rejected the message in /var/www/html/app/Jobs/SendWelcomeEmail.php:42\nStack trace:\n#0 /var/www/html/vendor/secret-frame.php(10): handle()",
            'failed_at' => now(),
        ], $overrides));

        return $uuid;
    }

    public function test_only_the_platform_team_may_list_retry_or_discard(): void
    {
        $uuid = $this->plant();

        $this->assertPlatformTeamOnly('GET', self::LIST);
        $this->assertRefusedBelowPlatformTeam('POST', self::LIST . "/{$uuid}/retry");
        $this->assertRefusedBelowPlatformTeam('DELETE', self::LIST . "/{$uuid}");
        $this->assertSame(1, DB::table('failed_jobs')->where('uuid', $uuid)->count(), 'a refused discard must not delete');
    }

    public function test_the_list_names_the_job_and_gives_one_masked_line_of_the_reason(): void
    {
        $uuid = $this->plant();
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::LIST)->assertStatus(200);
        $row = collect($response->json('data.jobs'))->firstWhere('id', $uuid);

        $this->assertNotNull($row, 'the planted job is listed');
        $this->assertSame(['id', 'job', 'queue', 'failed_at', 'reason'], array_keys($row));
        $this->assertSame('SendWelcomeEmail', $row['job']);
        $this->assertSame('default', $row['queue']);
        $this->assertNotFalse(strtotime((string) $row['failed_at']));
        $this->assertStringContainsString('RuntimeException', $row['reason']);
        $this->assertStringContainsString('[email]', $row['reason']);
        $this->assertGreaterThanOrEqual(1, $response->json('data.total'));
    }

    public function test_nothing_from_inside_the_job_is_sent(): void
    {
        $this->plant();
        $this->actAsPlatformTeam();

        $body = (string) $this->apiGet(self::LIST)->assertStatus(200)->getContent();

        $this->assertStringNotContainsString('secret.member', $body, 'a member email from the payload or the reason');
        $this->assertStringNotContainsString('Mary Surname', $body, 'the payload');
        $this->assertStringNotContainsString('secret-frame', $body, 'the stack trace');
        $this->assertStringNotContainsString('Stack trace', $body);
    }

    public function test_a_job_whose_payload_cannot_be_read_is_still_listed(): void
    {
        $uuid = $this->plant(['payload' => 'not json', 'exception' => '']);
        $this->actAsPlatformTeam();

        $row = collect($this->apiGet(self::LIST)->json('data.jobs'))->firstWhere('id', $uuid);

        $this->assertNotNull($row);
        $this->assertNull($row['job']);
        $this->assertNull($row['reason']);
    }

    public function test_the_newest_failure_comes_first_and_the_list_is_paged(): void
    {
        $old = $this->plant(['failed_at' => now()->subDays(3)]);
        $new = $this->plant(['failed_at' => now()->addMinute()]);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::LIST . '?per_page=1')->assertStatus(200);

        $this->assertCount(1, $response->json('data.jobs'));
        $this->assertSame($new, $response->json('data.jobs.0.id'));
        $this->assertSame(1, $response->json('data.per_page'));
        $this->assertNotSame($old, $response->json('data.jobs.0.id'));
    }

    public function test_retry_asks_the_queue_to_run_that_job_again(): void
    {
        $uuid = $this->plant();
        $this->actAsPlatformTeam();
        Artisan::shouldReceive('call')->once()->with('queue:retry', ['id' => [$uuid]])->andReturn(0);

        $this->apiPost(self::LIST . "/{$uuid}/retry")->assertStatus(200)->assertJsonPath('data.retried', true);
    }

    public function test_discard_removes_that_job_and_only_that_job(): void
    {
        $uuid = $this->plant();
        $other = $this->plant();
        $this->actAsPlatformTeam();

        $this->apiDelete(self::LIST . "/{$uuid}")->assertStatus(200)->assertJsonPath('data.discarded', true);

        $this->assertSame(0, DB::table('failed_jobs')->where('uuid', $uuid)->count());
        $this->assertSame(1, DB::table('failed_jobs')->where('uuid', $other)->count());
    }

    public function test_a_job_that_does_not_exist_is_a_404_not_a_success(): void
    {
        $this->actAsPlatformTeam();
        $missing = (string) Str::uuid();
        Artisan::shouldReceive('call')->never();

        $this->apiPost(self::LIST . "/{$missing}/retry")->assertStatus(404);
        $this->apiDelete(self::LIST . "/{$missing}")->assertStatus(404);
    }
}
