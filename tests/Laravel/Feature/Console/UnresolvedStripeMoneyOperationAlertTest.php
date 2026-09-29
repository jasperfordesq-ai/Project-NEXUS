<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Console;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * F-283 — a Stripe payout/refund/reversal whose outcome is unknown must reach
 * a person. stripe:check-stuck-webhooks (daily) raises it.
 */
final class UnresolvedStripeMoneyOperationAlertTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['ok' => true], 200)]);
        // Isolate from rows other suites may have left in a shared database.
        DB::table('stripe_money_operations')->whereIn('status', ['unknown', 'pending'])->delete();
        DB::table('stripe_webhook_events')->where('status', 'failed')->delete();
    }

    private function operation(string $status, \DateTimeInterface $updatedAt): string
    {
        $key = 'f283-alert-' . uniqid('', true);
        DB::table('stripe_money_operations')->insert([
            'tenant_id' => $this->testTenantId, 'operation_key' => $key, 'kind' => 'marketplace_payout',
            'subject_type' => 'marketplace_payment', 'subject_id' => 1, 'amount_minor' => 950, 'currency' => 'eur',
            'status' => $status, 'attempts' => 1, 'created_at' => $updatedAt, 'updated_at' => $updatedAt,
        ]);

        return $key;
    }

    public function test_an_old_unknown_money_movement_raises_the_alert(): void
    {
        $key = $this->operation('unknown', now()->subHours(7));

        $this->artisan('stripe:check-stuck-webhooks')
            ->expectsOutputToContain($key)
            ->assertExitCode(1);
    }

    public function test_an_old_pending_money_movement_raises_the_alert(): void
    {
        $this->operation('pending', now()->subHours(7));

        $this->artisan('stripe:check-stuck-webhooks')->assertExitCode(1);
    }

    public function test_settled_or_recent_movements_do_not_alert(): void
    {
        $this->operation('succeeded', now()->subDays(3));
        $this->operation('failed', now()->subDays(3));
        $this->operation('unknown', now()->subHour());

        $this->artisan('stripe:check-stuck-webhooks')->assertExitCode(0);
    }
}
