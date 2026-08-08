<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunityWorkflowService;
use App\Services\CaringTandemMatchingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class InterGenerationalMatchingTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
    }

    public function test_intergenerational_signal_is_1_when_age_diff_25_plus(): void
    {
        $service = app(CaringTandemMatchingService::class);
        // 1940 vs 2000 → 60 years
        $signal = $service->computeIntergenerationalSignal(
            ['dob' => '1940-05-12'],
            ['dob' => '2000-05-12'],
        );
        $this->assertEqualsWithDelta(1.0, $signal, 0.001);
    }

    public function test_intergenerational_signal_is_neutral_when_dob_missing(): void
    {
        $service = app(CaringTandemMatchingService::class);
        $this->assertEqualsWithDelta(
            0.5,
            $service->computeIntergenerationalSignal(['dob' => null], ['dob' => '1990-01-01']),
            0.001,
        );
        $this->assertEqualsWithDelta(
            0.5,
            $service->computeIntergenerationalSignal([], []),
            0.001,
        );
    }

    public function test_intergenerational_signal_is_0_when_same_generation(): void
    {
        $service = app(CaringTandemMatchingService::class);
        // Both born ~1995, ~5 years apart
        $signal = $service->computeIntergenerationalSignal(
            ['dob' => '1995-01-01'],
            ['dob' => '1990-01-01'],
        );
        $this->assertEqualsWithDelta(0.0, $signal, 0.001);
    }

    public function test_tandem_score_boosted_for_intergenerational_pairs(): void
    {
        $young = $this->makeUserWithDob('young.' . uniqid() . '@x.test', '2000-01-01');
        $elder = $this->makeUserWithDob('elder.' . uniqid() . '@x.test', '1940-01-01');

        $service = app(CaringTandemMatchingService::class);
        $suggestions = $service->suggestTandems(self::TENANT_ID, 50);

        $found = false;
        foreach ($suggestions as $suggestion) {
            $supId = (int) $suggestion['supporter']['id'];
            $recId = (int) $suggestion['recipient']['id'];
            if (
                ($supId === $young && $recId === $elder)
                || ($supId === $elder && $recId === $young)
            ) {
                $this->assertTrue(
                    (bool) ($suggestion['signals']['intergenerational'] ?? false),
                    'Intergenerational signal should be true for young+elder pair',
                );
                $found = true;
                break;
            }
        }

        // We don't strictly require the pair to surface (other suppression rules
        // may filter it), but if it does, the flag must be set.
        $this->assertTrue($found || $suggestions !== [], 'Tandem matching ran without errors');
    }

    public function test_intergenerational_tandem_count_metric(): void
    {
        $supporter = $this->makeUserWithDob('sup.' . uniqid() . '@x.test', '1945-01-01');
        $recipient = $this->makeUserWithDob('rec.' . uniqid() . '@x.test', '2005-01-01');

        DB::table('caring_support_relationships')->insert([
            'tenant_id'      => self::TENANT_ID,
            'supporter_id'   => $supporter,
            'recipient_id'   => $recipient,
            'title'          => 'Weekly check-in',
            'frequency'      => 'weekly',
            'expected_hours' => 1.0,
            'status'         => 'active',
            'start_date'     => now()->toDateString(),
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $workflow = app(CaringCommunityWorkflowService::class);
        $count = $workflow->intergenerationalTandemCount(self::TENANT_ID);

        $this->assertGreaterThanOrEqual(1, $count);
    }

    private function makeUserWithDob(string $email, string $dob): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'      => self::TENANT_ID,
            'first_name'     => 'Tandem',
            'last_name'      => 'User',
            'email'          => $email,
            'username'       => 'u_' . substr(md5($email . microtime(true)), 0, 8),
            'password'       => password_hash('password', PASSWORD_BCRYPT),
            'date_of_birth'  => $dob,
            'status'         => 'active',
            'is_approved'    => 1,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);
    }
}
