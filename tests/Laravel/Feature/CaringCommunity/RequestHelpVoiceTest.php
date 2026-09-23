<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringHelpRequestNlpService;
use App\Services\TranscriptionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Testing\File as TestFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature test for AG36/AG37 audio-first help-request voice endpoint.
 *
 * NOTE: Only the alias-mock test (returns_parsed_intent) needs process
 * isolation, so @runInSeparateProcess lives on that method rather than the
 * class. The auth / feature-gate tests run in-process. Each $this->call()
 * carries HTTP_X_TENANT_ID so ResolveTenant pins the request to tenant 2 —
 * matching the acting user's tenant (factory observers otherwise leave the
 * request resolving a different tenant → tenant_mismatch 403).
 */
class RequestHelpVoiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2; // hour-timebank

    protected function setUp(): void
    {
        parent::setUp();
        $this->setCaringCommunityFeature(true);
        TenantContext::setById(self::TENANT_ID);
    }

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT_ID)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', self::TENANT_ID)
            ->update(['features' => json_encode($features)]);
    }

    private function makeMember(): int
    {
        $row = [
            'tenant_id'  => self::TENANT_ID,
            'first_name' => 'Voice',
            'last_name'  => 'Tester',
            'email'      => 'voice.' . uniqid() . '@example.com',
            'username'   => 'v_' . substr(md5(uniqid('', true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => 0,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ];

        if (Schema::hasColumn('users', 'is_approved')) {
            $row['is_approved'] = 1;
        }
        if (Schema::hasColumn('users', 'approved_at')) {
            $row['approved_at'] = now();
        }

        return (int) DB::table('users')->insertGetId($row);
    }

    private function fakeAudio(): UploadedFile
    {
        // Tiny fake webm payload (content does not matter — services are mocked).
        return TestFile::create('voice.webm', 1)->mimeType('audio/webm');
    }

    public function test_voice_endpoint_requires_auth(): void
    {
        $resp = $this->postJson('/api/v2/caring-community/request-help/voice');
        $this->assertContains($resp->status(), [401, 403]);
    }

    public function test_voice_endpoint_403_when_caring_community_feature_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        TenantContext::setById(self::TENANT_ID);

        $member = $this->makeMember();
        $userModel = User::query()->find($member);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel);

        $resp = $this->call(
            'POST',
            '/api/v2/caring-community/request-help/voice',
            [],
            [],
            ['audio' => $this->fakeAudio()],
            ['HTTP_ACCEPT' => 'application/json', 'HTTP_X_TENANT_ID' => (string) self::TENANT_ID]
        );

        $this->assertSame(403, $resp->status());
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_voice_endpoint_returns_parsed_intent_when_services_succeed(): void
    {
        $member = $this->makeMember();
        $userModel = User::query()->find($member);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel);

        // F-138: voice help honours the administrator's AI master switch.
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => self::TENANT_ID, 'setting_key' => 'ai_enabled'],
            ['setting_value' => '1', 'updated_at' => now()]
        );

        // Mock TranscriptionService::transcribe — it's a static method on a real class.
        // We swap the class with a Mockery alias; if the class is already loaded the
        // alias mock will still intercept the static call for the duration of the test.
        $transcriptMock = \Mockery::mock('alias:' . TranscriptionService::class);
        $transcriptMock->shouldReceive('transcribe')
            ->once()
            ->andReturn(['text' => 'I need a lift to the doctor tomorrow at 3pm', 'language' => 'en']);

        $nlpMock = \Mockery::mock('alias:' . CaringHelpRequestNlpService::class);
        $nlpMock->shouldReceive('extract')
            ->once()
            ->andReturn([
                'category'           => 'transport',
                'when'               => '2030-01-01T15:00:00+00:00',
                'contact_preference' => 'phone',
                'raw_text'           => 'I need a lift to the doctor tomorrow at 3pm',
            ]);

        $resp = $this->call(
            'POST',
            '/api/v2/caring-community/request-help/voice',
            ['locale' => 'en'],
            [],
            ['audio' => $this->fakeAudio()],
            ['HTTP_ACCEPT' => 'application/json', 'HTTP_X_TENANT_ID' => (string) self::TENANT_ID]
        );

        $this->assertSame(200, $resp->status(), 'body=' . $resp->getContent());
        $body = $resp->json();
        $data = $body['data'] ?? $body;
        $this->assertSame('transport', $data['suggested_category']);
        $this->assertSame('phone', $data['suggested_contact_preference']);
        $this->assertSame('I need a lift to the doctor tomorrow at 3pm', $data['transcript']);
        $this->assertNotNull($data['suggested_when']);
    }

    protected function tearDown(): void
    {
        \Mockery::close();
        parent::tearDown();
    }
}
