<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\TenantProvisioning;

use App\Jobs\ProvisionTenantJob;
use App\Models\User;
use App\Services\TenantProvisioning\TenantProvisioningService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class ApproveProvisionsTest extends TestCase
{
    use DatabaseTransactions;

    public function test_approve_dispatches_provision_job(): void
    {
        if (! TenantProvisioningService::isAvailable()) {
            $this->markTestSkipped('tenant_provisioning_requests table not migrated');
        }

        Bus::fake();

        // The provisioning queue is the platform team's since 15 Nov 2026 (E-128).
        $superAdmin = User::factory()->create([
            'tenant_id'      => $this->testTenantId,
            'is_super_admin' => true,
            'is_god'         => true,
        ]);
        Sanctum::actingAs($superAdmin);

        $email = 'approve+' . uniqid('', true) . '@example.org';
        $slug  = 'appr-' . substr(md5(uniqid('', true)), 0, 10);

        $requestId = DB::table(TenantProvisioningService::TABLE)->insertGetId([
            'applicant_name'   => 'Approve Tester',
            'applicant_email'  => $email,
            'org_name'         => 'Approve Coop',
            'country_code'     => 'CH',
            'requested_slug'   => $slug,
            'tenant_category'  => 'community',
            'languages'        => json_encode(['en']),
            'default_language' => 'en',
            'status'           => 'pending',
            'status_token'     => bin2hex(random_bytes(20)),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $response = $this->postJson("/api/v2/super-admin/provisioning-requests/{$requestId}/approve");
        $response->assertStatus(200);
        $response->assertJsonPath('data.queued', true);

        Bus::assertDispatched(ProvisionTenantJob::class, fn ($job) => $job->requestId === (int) $requestId);
    }

    public function test_provisioning_pipeline_creates_tenant_and_admin(): void
    {
        if (! TenantProvisioningService::isAvailable()) {
            $this->markTestSkipped('tenant_provisioning_requests table not migrated');
        }

        $email = 'pipeline+' . uniqid('', true) . '@example.org';
        $slug  = 'pipe-' . substr(md5(uniqid('', true)), 0, 10);

        $requestId = DB::table(TenantProvisioningService::TABLE)->insertGetId([
            'applicant_name'   => 'Pipeline Admin',
            'applicant_email'  => $email,
            'org_name'         => 'Pipeline Org',
            'country_code'     => 'CH',
            'requested_slug'   => $slug,
            'tenant_category'  => 'community',
            'languages'        => json_encode(['en']),
            'default_language' => 'en',
            'status'           => 'pending',
            'status_token'     => bin2hex(random_bytes(20)),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $superAdmin = User::factory()->create([
            'tenant_id'      => $this->testTenantId,
            'is_super_admin' => true,
        ]);

        TenantProvisioningService::approveAndProvision((int) $requestId, (int) $superAdmin->id);

        $row = DB::table(TenantProvisioningService::TABLE)->where('id', $requestId)->first();
        $this->assertSame('provisioned', $row->status);
        $this->assertNotNull($row->provisioned_tenant_id);

        $tenant = DB::table('tenants')->where('id', $row->provisioned_tenant_id)->first();
        $this->assertNotNull($tenant);
        $this->assertSame($slug, $tenant->slug);

        $adminUser = DB::table('users')
            ->where('tenant_id', $row->provisioned_tenant_id)
            ->where('email', $email)
            ->first();
        $this->assertNotNull($adminUser, 'Admin user should be created');
        $this->assertSame('admin', $adminUser->role);
    }
}
