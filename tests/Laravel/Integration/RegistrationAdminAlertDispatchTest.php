<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Events\UserRegistered;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Laravel\TestCase;

/**
 * Proves the public registration route reaches the admin-alert event.
 * The event is captured before any mail or push listener can run.
 */
class RegistrationAdminAlertDispatchTest extends TestCase
{
    use DatabaseTransactions;

    private ?int $syntheticTenantId = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->syntheticTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'C1 Synthetic Registration Test',
            'slug' => 'c1-synthetic-' . Str::lower(Str::random(12)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->withTenant($this->syntheticTenantId);
        $settings = app(TenantSettingsService::class);
        $settings->set($this->syntheticTenantId, 'registration_mode', 'open');
        $settings->set($this->syntheticTenantId, 'general.registration_mode', 'open');
    }

    protected function tearDown(): void
    {
        if ($this->syntheticTenantId !== null) {
            app(TenantSettingsService::class)->clearCacheForTenant($this->syntheticTenantId);
        }
        parent::tearDown();
    }

    public function test_endpoint_dispatches_tenant_scoped_user_registered_event(): void
    {
        Event::fake([UserRegistered::class]);
        $email = 'c1-synthetic-' . Str::lower(Str::random(12)) . '@gmail.com';
        $response = $this->apiPost('/v2/auth/register', [
            'first_name' => 'C1SyntheticRegistrant',
            'last_name' => 'Test',
            'email' => $email,
            'location' => 'Synthetic test location',
            'phone' => '+15551234567',
            'password' => 'Xq7!vM2pLw9zRt4B',
            'password_confirmation' => 'Xq7!vM2pLw9zRt4B',
            'terms_accepted' => true,
        ]);

        $response->assertStatus(201);
        Event::assertDispatched(UserRegistered::class, function (UserRegistered $event) use ($email): bool {
            return (int) $event->tenantId === $this->syntheticTenantId
                && $event->user->email === $email
                && (int) $event->user->tenant_id === $this->syntheticTenantId;
        });
    }
}
