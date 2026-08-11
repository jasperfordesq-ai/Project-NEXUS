<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\EmailMonitorService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A `suppressed` email is the suppression list doing its job — a deliberate
 * non-send, not a delivery failure.
 *
 * Counting it as one raised a CRITICAL "100% failure rate" alarm every hour for
 * days on production, caused by three demo addresses on recurring digests. The
 * rate was a share of a tiny denominator, so a quiet day looked like total
 * failure. Found while investigating an unrelated report, 2026-08-11.
 */
class EmailMonitorSuppressionSeverityTest extends TestCase
{
    use DatabaseTransactions;

    private EmailMonitorService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new EmailMonitorService();

        // Isolate the 24h window this tenant's warnings are computed from.
        DB::table('email_log')->where('tenant_id', $this->testTenantId)->delete();
    }

    private function logEmail(string $status, int $count = 1): void
    {
        for ($i = 0; $i < $count; $i++) {
            DB::table('email_log')->insert([
                'tenant_id' => $this->testTenantId,
                'recipient_email' => "monitor-{$status}-{$i}@example.test",
                'category' => 'civic_digest',
                'status' => $status,
                'created_at' => now()->subMinutes(5),
                'updated_at' => now()->subMinutes(5),
            ]);
        }
    }

    /** @return array<string, array<string, mixed>> code => warning */
    private function warningsByCode(): array
    {
        $out = [];
        foreach ($this->service->getWarnings($this->testTenantId) as $warning) {
            $out[(string) $warning['code']] = $warning;
        }

        return $out;
    }

    public function test_suppressions_alone_do_not_raise_a_failure_warning(): void
    {
        $this->logEmail('suppressed', 3);

        $warnings = $this->warningsByCode();

        $this->assertArrayNotHasKey(
            'recent_email_failures',
            $warnings,
            'Suppressed sends must not be reported as delivery failures.'
        );
    }

    public function test_a_few_suppressions_are_reported_as_info_so_they_never_alert(): void
    {
        $this->logEmail('suppressed', 3);

        $warnings = $this->warningsByCode();

        $this->assertArrayHasKey('recent_email_suppressions', $warnings);
        // EmailHealthAlert drops `info` before alerting — this is what keeps the
        // hourly Slack/log alarm quiet for a handful of demo addresses.
        $this->assertSame('info', $warnings['recent_email_suppressions']['severity']);
    }

    public function test_mass_suppression_still_escalates_to_a_real_warning(): void
    {
        // A domain-wide block looks like this: many suppressions, dominating all
        // mail. That must remain visible.
        $this->logEmail('suppressed', 12);
        $this->logEmail('delivered', 2);

        $warnings = $this->warningsByCode();

        $this->assertArrayHasKey('recent_email_suppressions', $warnings);
        $this->assertSame('warning', $warnings['recent_email_suppressions']['severity']);
    }

    public function test_real_failures_are_still_reported_and_rated_against_attempted_sends(): void
    {
        $this->logEmail('failed', 2);
        $this->logEmail('delivered', 2);
        // Suppressions must not dilute the real failure rate.
        $this->logEmail('suppressed', 6);

        $warnings = $this->warningsByCode();

        $this->assertArrayHasKey('recent_email_failures', $warnings);
        $this->assertSame(2, $warnings['recent_email_failures']['params']['count']);
        $this->assertSame(
            50.0,
            $warnings['recent_email_failures']['params']['rate'],
            '2 failed of 4 attempted is 50% — the 6 suppressed are not attempts.'
        );
    }
}
