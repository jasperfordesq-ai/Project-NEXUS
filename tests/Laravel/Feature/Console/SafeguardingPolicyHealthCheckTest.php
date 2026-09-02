<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Console;

use App\Models\User;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * The safeguarding policy-health pager: one daily alert when a tenant has
 * live vetted-interaction selections but a safeguarding policy that cannot
 * operate the contact gate — the state that silently emptied members'
 * matches for weeks (Sentry 134069538).
 */
class SafeguardingPolicyHealthCheckTest extends TestCase
{
    use DatabaseTransactions;

    public function test_alerts_when_a_tenant_has_live_selections_but_no_usable_policy(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        app(SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->protectMember($member);

        // The alarm logs through OperatorLog::withoutSentry(), i.e.
        // Log::stack(<channels minus sentry>)->error(...), so intercept the
        // stack rather than the facade's own error().
        $channelsSeen = [];
        $logger = \Mockery::spy(\Psr\Log\LoggerInterface::class);

        Log::shouldReceive('stack')
            ->andReturnUsing(function (array $channels) use (&$channelsSeen, $logger) {
                $channelsSeen[] = $channels;

                return $logger;
            });
        Log::shouldReceive('debug')->andReturnNull();
        Log::shouldReceive('info')->andReturnNull();
        Log::shouldReceive('warning')->andReturnNull();

        $this->artisan('safeguarding:check-policy-health')
            ->expectsOutputToContain((string) $this->testTenantId)
            ->assertExitCode(1);

        // Stable message string (the Sentry grouping key), volatile detail in
        // context only — the OverdueGdprRequestCheck rule.
        $logger->shouldHaveReceived('error')
            ->with(
                'Safeguarding contact gate unusable for tenants with live vetted-interaction selections',
                \Mockery::on(fn (array $context): bool => ($context['affected_count'] ?? 0) >= 1),
            )
            ->once();

        // 🔴 The regression this guards: one occurrence used to open TWO Sentry
        // groups (NEXUS-PHP-65 and -66 on 2026-08-30, same second) because the
        // log leg also reached Sentry, unfingerprinted.
        $this->assertNotSame([], $channelsSeen, 'The alarm did not log through a stack at all.');
        foreach ($channelsSeen as $channels) {
            $this->assertNotContains('sentry', $channels, 'The alarm log line must not reach Sentry on its own.');
        }
    }

    public function test_passes_when_the_policy_is_usable(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        app(SafeguardingJurisdictionService::class)->configure($this->testTenantId, 'ireland', $admin->id);

        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->protectMember($member);

        $this->artisan('safeguarding:check-policy-health')->assertExitCode(0);
    }

    public function test_passes_when_no_live_selections_exist_anywhere(): void
    {
        // Whatever other tenants exist in the fixture DB, none of THIS test's
        // rows are live: revoke rather than assume a pristine table.
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();

        $this->artisan('safeguarding:check-policy-health')->assertExitCode(0);
    }

    private function protectMember(User $member): void
    {
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_vetted_contact_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test safeguarded contact',
            'description' => 'Test safeguarded contact',
            'sort_order' => 999,
            'is_active' => 1,
            'is_required' => 0,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'garda_vetting',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}
