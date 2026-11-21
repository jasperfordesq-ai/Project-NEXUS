<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\EmailDispatchService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\OverLimitRule;
use Illuminate\Support\Facades\DB;

/**
 * Put a community into the state the daily check leaves it in once it has
 * told the community's admins, under its present terms, that it is at
 * (`reached`) or over its member number. "Stop new members joining" shuts a
 * door only in that state (JoiningGate), so every test of a shut door starts
 * here, exactly as a real run would leave the row.
 *
 * The terms key is the daily check's own (OverLimitRule::termsKey()); a test
 * that changes the terms afterwards must call this again, as the next run
 * would have to tell the community again.
 */
trait TellsCommunityOfMemberLimit
{
    private function tellCommunityOfMemberLimit(int $tenantId, string $stage = 'reached'): void
    {
        $limit = BillingAutomationService::watchedLimit($tenantId);
        if ($limit === null) {
            // No member number is watched, so nothing could be told.
            return;
        }

        $values = [
            'limit_terms_key' => OverLimitRule::termsKey($tenantId, $limit),
            'limit_notice_stage' => $stage,
            'limit_notice_at' => now()->format('Y-m-d H:i:s'),
            'over_limit_since' => $stage === 'over' ? now()->toDateString() : null,
        ];

        if (DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists()) {
            DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->update($values);
        } else {
            DB::table('tenant_billing_standing')->insert($values + ['tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now()]);
        }

        BillingLock::flush();
        JoiningGate::flush();
    }

    /**
     * For a test that lets a real daily run tell the community: a mail
     * provider that accepts, as BillingAutomationFixtures stands in.
     */
    private function standInAcceptingMailProvider(): void
    {
        // ProviderAcceptsEmailDispatch lives in the fixtures trait's file.
        trait_exists(BillingAutomationFixtures::class);
        app()->instance(EmailDispatchService::class, new ProviderAcceptsEmailDispatch());
    }
}
