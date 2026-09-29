<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Services\AdminBadgeCountService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-318 (E-062) — the admin "fraud alerts" badge counted `fraud_alerts` rows
 * with status 'new', a value outside that table's
 * enum('open','investigating','resolved','dismissed'), so it was permanently
 * 0. Nothing in app/ writes `fraud_alerts` at all: the queue the Fraud Alerts
 * screen actually shows (/admin/timebanking/alerts,
 * AdminTimebankingController::alerts) is `abuse_alerts`, filled by
 * AbuseDetectionService. The badge now counts that queue's open alerts — the
 * same predicate the timebanking stats use ('new' or 'reviewing').
 *
 * Controls: closed alerts and another community's alerts are not counted.
 */
class F318FraudAlertBadgeCountTest extends TestCase
{
    use DatabaseTransactions;

    public function test_the_badge_counts_the_open_alerts_the_fraud_alerts_screen_shows(): void
    {
        TenantContext::setById($this->testTenantId);
        $before = (new AdminBadgeCountService())->getCount('fraud_alerts');

        foreach (['new', 'reviewing', 'resolved', 'dismissed'] as $status) {
            $this->alert($this->testTenantId, $status);
        }
        $this->alert(999, 'new'); // another community

        TenantContext::setById($this->testTenantId);
        $after = (new AdminBadgeCountService())->getCount('fraud_alerts');

        $this->assertSame(2, $after - $before, 'only this community\'s new + reviewing alerts are counted');
        $this->assertSame(
            (int) DB::table('abuse_alerts')
                ->where('tenant_id', $this->testTenantId)
                ->whereIn('status', ['new', 'reviewing'])
                ->count(),
            $after,
            'the badge agrees with the open alerts on the screen it links to',
        );
    }

    private function alert(int $tenantId, string $status): void
    {
        DB::table('abuse_alerts')->insert([
            'tenant_id' => $tenantId,
            'alert_type' => 'large_transfer',
            'severity' => 'medium',
            'details' => json_encode(['source' => 'F318']),
            'status' => $status,
            'created_at' => now(),
        ]);
    }
}
