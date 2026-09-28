<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use App\Support\Authorization\MinimumAge;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * E-055 F-249 — the adults-only rule (owner decision 25 Sep 2026, F-160)
 * applies to paper onboarding: a coordinator confirming a paper form whose
 * date of birth is under 18 must not create an account. Adults, and forms with
 * no date of birth, are confirmed as before.
 */
final class F249PaperOnboardingMinimumAgeTest extends TestCase
{
    use DatabaseTransactions;

    private int $coordinatorId;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById($this->testTenantId);
        $this->coordinatorId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId, 'first_name' => 'Coord', 'last_name' => 'F249',
            'name' => 'Coord F249', 'email' => 'coord.f249.' . uniqid() . '@example.test',
            'role' => 'admin', 'is_approved' => 1, 'created_at' => now(),
        ]);
    }

    private function intake(): int
    {
        return (int) DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id' => $this->testTenantId, 'uploaded_by' => $this->coordinatorId, 'status' => 'pending_review',
            'original_filename' => 'f249.pdf', 'stored_path' => 'caring-paper-onboarding/2/f249.pdf',
            'ocr_provider' => 'manual_review_stub', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function confirm(int $intakeId, string $email, ?string $dob): array
    {
        $fields = ['name' => 'Paper Applicant', 'email' => $email];
        if ($dob !== null) {
            $fields['date_of_birth'] = $dob;
        }

        return app(PaperOnboardingIntakeService::class)->confirm($this->testTenantId, $intakeId, $this->coordinatorId, $fields);
    }

    public function test_under_18_date_of_birth_creates_no_account(): void
    {
        $intakeId = $this->intake();
        $email = 'f249.minor.' . uniqid() . '@example.test';

        $result = $this->confirm($intakeId, $email, now()->subYears(15)->format('Y-m-d'));

        $this->assertFalse($result['success']);
        $this->assertSame(MinimumAge::DATE_OF_BIRTH_ERROR_CODE, $result['code']);
        $this->assertSame(0, DB::table('users')->where('email', $email)->count());
        $this->assertSame('pending_review', DB::table('caring_paper_onboarding_intakes')->where('id', $intakeId)->value('status'));
    }

    public function test_control_adult_and_missing_date_of_birth_are_confirmed(): void
    {
        foreach ([now()->subYears(40)->format('Y-m-d'), null] as $dob) {
            $email = 'f249.adult.' . uniqid() . '@example.test';
            $result = $this->confirm($this->intake(), $email, $dob);

            $this->assertTrue($result['success'], 'An adult paper applicant must still be confirmed.');
            $this->assertSame(1, DB::table('users')->where('email', $email)->count());
        }
    }
}
