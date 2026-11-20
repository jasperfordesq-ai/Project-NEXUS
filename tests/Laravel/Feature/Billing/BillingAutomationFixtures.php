<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use Illuminate\Support\Facades\DB;

/**
 * Communities, people and mail lookups shared by the daily-check tests.
 *
 * The using class must `use DatabaseTransactions` and call setUpAutomation()
 * / tearDownAutomation() from its own setUp / tearDown.
 */
trait BillingAutomationFixtures
{
    private function setUpAutomation(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=0');
        BillingLock::flush();
        BillingSettings::flush();
    }

    private function tearDownAutomation(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=30');

        // parent::tearDown() rolls the transaction back: it must always run.
        try {
            BillingLock::flush();
            BillingSettings::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'auto-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function person(int $tenantId, array $attributes): string
    {
        $email = 'auto.' . bin2hex(random_bytes(6)) . '@example.com';
        User::factory()->forTenant($tenantId)->create(array_merge([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ], $attributes));

        return $email;
    }

    /** @return list<object> */
    private function mailTo(string $email): array
    {
        return DB::table('email_log')->where('recipient_email', $email)->orderBy('id')->get()->all();
    }

    /** @param array<string, mixed> $values */
    private function standing(int $tenantId, array $values): void
    {
        $exists = DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists();
        if ($exists) {
            DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->update($values);

            return;
        }

        DB::table('tenant_billing_standing')->insert($values + ['tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function standingRow(int $tenantId): ?object
    {
        return DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->first();
    }

    /**
     * @param list<array{tenant_id:int, clock:string, action:string}> $outcome
     * @return list<string> "clock:action" for one community
     */
    private function actionsFor(array $outcome, int $tenantId): array
    {
        $actions = [];
        foreach ($outcome as $entry) {
            if ($entry['tenant_id'] === $tenantId) {
                $actions[] = $entry['clock'] . ':' . $entry['action'];
            }
        }

        return $actions;
    }

    private function switchOn(): void
    {
        BillingSettings::set('automation_enabled', true, null);
    }
}
