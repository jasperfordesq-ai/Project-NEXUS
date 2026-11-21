<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\EmailDispatchService;
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
        // The test environment has no mail server, so every real send ends
        // "failed" at the transport. The member-limit clock now records a
        // notice only when the mailer accepted it (task 5A, C1), so these
        // tests stand in a provider that accepts: see ProviderAcceptsEmailDispatch.
        app()->instance(EmailDispatchService::class, new ProviderAcceptsEmailDispatch());
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

/** A mail provider that is down: every send is refused, as EmailDispatchService answers then. */
final class RefusingEmailDispatch extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return false;
    }
}

/**
 * The real dispatch pipeline (refusals, the paused-community check, the
 * per-recipient limit, the email_log row the tests count), with a mail
 * provider that accepts. Only a send that went all the way to the transport
 * and failed there because no mail server runs in tests is answered true;
 * every earlier refusal still answers false.
 */
final class ProviderAcceptsEmailDispatch extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $before = (int) DB::table('email_log')->max('id');
        if (parent::send($to, $subject, $body, $options)) {
            return true;
        }

        return DB::table('email_log')
            ->where('id', '>', $before)
            ->where('recipient_email', $to)
            ->where('status', 'failed')
            ->where('error', 'SMTP failed')
            ->exists();
    }
}
