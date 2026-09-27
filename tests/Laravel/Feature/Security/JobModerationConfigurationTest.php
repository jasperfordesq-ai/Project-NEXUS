<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Events\JobVacancyCreated;
use App\Models\User;
use App\Services\JobConfigurationService;
use App\Services\JobModerationService;
use App\Services\JobVacancyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

/** F-215: the administrator's persisted moderation switch must govern job publication. */
class JobModerationConfigurationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([JobVacancyCreated::class]);
        $config = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        unset($config['jobs']['moderation_enabled'], $config['jobs_require_moderation']);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', JobConfigurationService::CONFIG_MODERATION_ENABLED)->delete();
        Cache::forget("job_config:{$this->testTenantId}");
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        Cache::forget("job_config:{$this->testTenantId}");
        parent::tearDown();
    }

    public function test_admin_configuration_switch_controls_publication(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        $service = app(JobVacancyService::class);

        JobConfigurationService::set(JobConfigurationService::CONFIG_MODERATION_ENABLED, true);
        $this->assertTrue(JobModerationService::isModerationEnabled($this->testTenantId));
        $pendingId = $service->create($member->id, [
            'title' => 'Synthetic moderated volunteer role',
            'description' => 'A test job requiring administrator review.',
            'type' => 'volunteer', 'commitment' => 'flexible', 'status' => 'open',
        ]);
        $this->assertGreaterThan(0, (int) $pendingId, json_encode($service->getErrors()));
        $pending = DB::table('job_vacancies')->where('id', $pendingId)->first();
        $this->assertSame('draft', $pending->status);
        $this->assertSame('pending_review', $pending->moderation_status);

        JobConfigurationService::set(JobConfigurationService::CONFIG_MODERATION_ENABLED, false);
        $this->assertFalse(JobModerationService::isModerationEnabled($this->testTenantId));
        $openId = $service->create($member->id, [
            'title' => 'Synthetic unmoderated volunteer role',
            'description' => 'A second test job after moderation is disabled.',
            'type' => 'volunteer', 'commitment' => 'flexible', 'status' => 'open',
        ]);
        $this->assertGreaterThan(0, (int) $openId, json_encode($service->getErrors()));
        $open = DB::table('job_vacancies')->where('id', $openId)->first();
        $this->assertSame('open', $open->status);
    }

    public function test_legacy_tenant_configuration_remains_a_fallback(): void
    {
        $config = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        $config['jobs']['moderation_enabled'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(JobModerationService::isModerationEnabled($this->testTenantId));

        JobConfigurationService::set(JobConfigurationService::CONFIG_MODERATION_ENABLED, false);
        $this->assertFalse(JobModerationService::isModerationEnabled($this->testTenantId));
    }
}
