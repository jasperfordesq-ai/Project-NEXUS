<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Jobs\CreateSupportJiraTicket;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * HELP-11 (3 Oct 2026): a member asked to attach a screenshot when reporting a
 * problem. Screenshots are checked, re-encoded (no hidden metadata), kept on
 * the private disk, copied to the Jira ticket, and shown only to staff.
 */
class SupportReportScreenshotTest extends TestCase
{
    use DatabaseTransactions;

    private const BASE = 'https://jira.example.test';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Http::preventStrayRequests();
        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function __construct()
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
        config(['support_jira.enabled' => false]);
    }

    public function test_a_member_can_send_screenshots_with_a_report(): void
    {
        $member = $this->member();

        $response = $this->sendReport($member, [
            'screenshots' => [
                UploadedFile::fake()->image('first.png', 640, 400),
                UploadedFile::fake()->image('second.jpg', 800, 600),
            ],
            'include_diagnostics' => '1',
            'diagnostics' => json_encode(['route' => '/feed', 'entries' => []]),
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.report.screenshots', 2);

        $report = DB::table('support_reports')->where('id', $response->json('data.report.id'))->first();
        $this->assertNotNull($report->diagnostics, 'diagnostics sent as a JSON string in a multipart form were lost');

        $rows = DB::table('support_report_attachments')->where('support_report_id', $report->id)->orderBy('id')->get();
        $this->assertCount(2, $rows);
        $this->assertSame(['image/png', 'image/jpeg'], $rows->pluck('mime')->all());
        foreach ($rows as $row) {
            $this->assertSame($this->testTenantId, (int) $row->tenant_id);
            $this->assertStringStartsWith('support-reports/' . $this->testTenantId . '/' . $report->id . '/', $row->path);
            Storage::disk('local')->assertExists($row->path);
            $this->assertNotFalse(@getimagesizefromstring(Storage::disk('local')->get($row->path)));
        }
        $this->assertSame([640, 400], [(int) $rows[0]->width, (int) $rows[0]->height]);
    }

    public function test_hidden_metadata_such_as_a_location_is_not_kept(): void
    {
        $member = $this->member();
        $jpeg = $this->jpegWithExifComment('GPS-SECRET-53.3498N-6.2603W');

        $response = $this->sendReport($member, [
            'screenshots' => [UploadedFile::fake()->createWithContent('photo.jpg', $jpeg)],
        ]);

        $response->assertCreated();
        $path = (string) DB::table('support_report_attachments')
            ->where('support_report_id', $response->json('data.report.id'))
            ->value('path');
        $stored = Storage::disk('local')->get($path);
        $this->assertStringNotContainsString('GPS-SECRET', $stored);
        $this->assertNotFalse(@getimagesizefromstring($stored));
    }

    public function test_a_file_that_is_not_an_image_refuses_the_whole_report(): void
    {
        $member = $this->member();

        $response = $this->sendReport($member, [
            'screenshots' => [UploadedFile::fake()->createWithContent('screenshot.png', "<?php echo 'not an image';")],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.message', __('api.support_reports_screenshot_invalid'));
        $this->assertSame(0, DB::table('support_reports')->where('user_id', $member->id)->count());
    }

    public function test_no_more_than_three_screenshots(): void
    {
        $member = $this->member();

        $response = $this->sendReport($member, [
            'screenshots' => array_map(fn ($n) => UploadedFile::fake()->image("s{$n}.png", 50, 50), range(1, 4)),
        ]);

        $response->assertStatus(422);
        $this->assertSame(0, DB::table('support_reports')->where('user_id', $member->id)->count());
    }

    public function test_a_report_without_screenshots_still_works_as_json(): void
    {
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiPost('/v2/support/reports', [
            'summary' => 'Calendar looks wrong',
            'description' => 'The calendar page is showing last month by default.',
            'impact' => 'minor',
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.report.screenshots', 0);
    }

    public function test_screenshots_are_attached_to_the_jira_ticket_for_the_member_to_see(): void
    {
        $this->enableJira();
        $member = $this->member();
        $reportId = $this->reportWithScreenshots($member, 2);
        $this->fakeJira();

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        $create = $this->recorded('/rest/servicedeskapi/request', 'POST');
        $this->assertStringContainsString('Screenshots from the member: 2 attached', $create->data()['requestFieldValues']['description']);

        $upload = $this->recorded('/rest/servicedeskapi/servicedesk/2/attachTemporaryFile', 'POST');
        $this->assertNotNull($upload, 'the screenshots were not uploaded to Jira');
        $this->assertStringContainsString('screenshot-NXR-T-SHOT01-1.png', $upload->body());
        $this->assertStringContainsString('screenshot-NXR-T-SHOT01-2.png', $upload->body());

        $attach = $this->recorded('/rest/servicedeskapi/request/HELP-42/attachment', 'POST');
        $this->assertTrue($attach->data()['public'], 'the member should see their own screenshots on the request');
        $this->assertSame(2, DB::table('support_report_attachments')->where('support_report_id', $reportId)->whereNotNull('jira_attached_at')->count());
    }

    public function test_a_failed_screenshot_attach_retries_without_raising_a_second_ticket(): void
    {
        $this->enableJira();
        $member = $this->member();
        $reportId = $this->reportWithScreenshots($member, 1);
        $this->fakeJira(attachSucceeds: false);

        try {
            (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();
            $this->fail('a failed screenshot attach must make the job retry');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('attach screenshots', $e->getMessage());
        }
        $this->assertSame('HELP-42', DB::table('support_reports')->where('id', $reportId)->value('jira_issue_key'));

        (new CreateSupportJiraTicket($reportId, $this->testTenantId))->handle();

        $creates = Http::recorded(fn (Request $r) => $r->method() === 'POST'
            && parse_url($r->url(), PHP_URL_PATH) === '/rest/servicedeskapi/request');
        $this->assertCount(1, $creates, 'the retry raised a second ticket');
        $this->assertNotNull($this->recorded('/rest/servicedeskapi/request/HELP-42/attachment', 'POST'));
        $this->assertSame(1, DB::table('support_report_attachments')->where('support_report_id', $reportId)->whereNotNull('jira_attached_at')->count());
    }

    public function test_an_admin_sees_the_screenshots_and_can_open_one(): void
    {
        $member = $this->member();
        $reportId = $this->reportWithScreenshots($member, 1);
        $admin = User::factory()->admin()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin, ['*']);

        $detail = $this->apiGet('/v2/admin/support-reports/' . $reportId);
        $detail->assertOk();
        $detail->assertJsonCount(1, 'data.screenshots');
        $detail->assertJsonMissingPath('data.screenshots.0.path');
        $screenshotId = (int) $detail->json('data.screenshots.0.id');

        $image = $this->get('/api/v2/admin/support-reports/' . $reportId . '/screenshots/' . $screenshotId, $this->withTenantHeader());
        $image->assertOk();
        $image->assertHeader('Content-Type', 'image/png');
        $image->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertNotFalse(@getimagesizefromstring((string) $image->getContent()));
    }

    public function test_a_member_cannot_open_a_screenshot(): void
    {
        $member = $this->member();
        $reportId = $this->reportWithScreenshots($member, 1);
        $screenshotId = (int) DB::table('support_report_attachments')->where('support_report_id', $reportId)->value('id');
        Sanctum::actingAs($member, ['*']);

        $response = $this->get('/api/v2/admin/support-reports/' . $reportId . '/screenshots/' . $screenshotId, $this->withTenantHeader());

        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_a_screenshot_cannot_be_read_through_another_report(): void
    {
        $member = $this->member();
        $reportA = $this->reportWithScreenshots($member, 1, 'NXR-T-SHOTA');
        $reportB = $this->reportWithScreenshots($member, 1, 'NXR-T-SHOTB');
        $screenshotOfB = (int) DB::table('support_report_attachments')->where('support_report_id', $reportB)->value('id');
        Sanctum::actingAs(User::factory()->admin()->forTenant($this->testTenantId)->create(), ['*']);

        $this->get('/api/v2/admin/support-reports/' . $reportA . '/screenshots/' . $screenshotOfB, $this->withTenantHeader())
            ->assertNotFound();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'shot-' . uniqid('', true) . '@example.test',
        ]);
    }

    private function sendReport(User $member, array $extra): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($member, ['*']);

        return $this->post('/api/v2/support/reports', array_merge([
            'request_type' => 'broken',
            'summary' => 'Poll content not aligned',
            'description' => 'The poll lost its line breaks once it was published.',
            'impact' => 'cosmetic',
        ], $extra), $this->withTenantHeader());
    }

    private function reportWithScreenshots(User $member, int $count, string $reference = 'NXR-T-SHOT01'): int
    {
        $reportId = (int) DB::table('support_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'reference' => $reference,
            'source' => 'in_app',
            'request_type' => 'broken',
            'summary' => 'Poll content not aligned',
            'description' => 'The poll lost its line breaks once it was published.',
            'impact' => 'cosmetic',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        for ($n = 1; $n <= $count; $n++) {
            $path = sprintf('support-reports/%d/%d/%s.png', $this->testTenantId, $reportId, bin2hex(random_bytes(8)));
            $image = imagecreatetruecolor(20, 10);
            ob_start();
            imagepng($image);
            Storage::disk('local')->put($path, (string) ob_get_clean());
            DB::table('support_report_attachments')->insert([
                'tenant_id' => $this->testTenantId,
                'support_report_id' => $reportId,
                'path' => $path,
                'mime' => 'image/png',
                'size_bytes' => 100,
                'width' => 20,
                'height' => 10,
                'original_name' => "shot{$n}.png",
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        return $reportId;
    }

    /** A real JPEG with an APP1 "Exif" segment carrying a marker string. */
    private function jpegWithExifComment(string $marker): string
    {
        $image = imagecreatetruecolor(32, 24);
        ob_start();
        imagejpeg($image);
        $jpeg = (string) ob_get_clean();

        $payload = "Exif\0\0" . $marker;
        $segment = "\xFF\xE1" . pack('n', strlen($payload) + 2) . $payload;

        return substr($jpeg, 0, 2) . $segment . substr($jpeg, 2);
    }

    private function enableJira(): void
    {
        config([
            'support_jira.enabled' => true,
            'support_jira.send_member_email' => false,
            'support_jira.site_url' => self::BASE,
            'support_jira.cloud_id' => '',
            'support_jira.service_desk_id' => '2',
            'support_jira.email' => 'service-account@example.test',
            'support_jira.api_token' => 'jira-token-must-never-leak',
            'support_jira.assignee_account_id' => '',
        ]);
    }

    private function fakeJira(bool $attachSucceeds = true): void
    {
        Http::fake([
            self::BASE . '/rest/servicedeskapi/request' => Http::response(['issueKey' => 'HELP-42', 'issueId' => '10042'], 201),
            self::BASE . '/rest/api/3/issue/HELP-42' => Http::response(null, 204),
            // When told to fail: the first upload is refused, the retry succeeds.
            self::BASE . '/rest/servicedeskapi/servicedesk/2/attachTemporaryFile' => $attachSucceeds
                ? Http::response(['temporaryAttachments' => [['temporaryAttachmentId' => 'temp-1'], ['temporaryAttachmentId' => 'temp-2']]], 201)
                : Http::sequence()
                    ->push(['errorMessage' => 'Service unavailable'], 503)
                    ->push(['temporaryAttachments' => [['temporaryAttachmentId' => 'temp-1']]], 201),
            self::BASE . '/rest/servicedeskapi/request/HELP-42/attachment' => Http::response([], 201),
        ]);
    }

    private function recorded(string $path, string $method): ?Request
    {
        $match = Http::recorded(fn (Request $r) => $r->method() === $method && parse_url($r->url(), PHP_URL_PATH) === $path);

        return $match->isEmpty() ? null : $match->last()[0];
    }
}
