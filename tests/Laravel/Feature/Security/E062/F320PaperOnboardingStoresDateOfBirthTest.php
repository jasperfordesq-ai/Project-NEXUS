<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use App\Services\TenantSettingsService;
use App\Support\Authorization\MinimumAge;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-320 (E-062, F-249 residual) — paper onboarding validated the date of birth
 * on the form (refusing under-18s) but never wrote it to users.date_of_birth:
 * it landed only in the intake row's corrected_fields JSON. Every later age
 * check (the sign-in gate, profile edits) therefore saw no date of birth at
 * all. The validated date must be stored on the account.
 */
class F320PaperOnboardingStoresDateOfBirthTest extends TestCase
{
    use DatabaseTransactions;

    private int $coordinatorId;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById($this->testTenantId);
        // Open community, so the account is created live and only the date matters here.
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $this->coordinatorId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId, 'first_name' => 'Coord', 'last_name' => 'F320',
            'name' => 'Coord F320', 'email' => 'coord.f320.' . uniqid() . '@example.test',
            'role' => 'admin', 'is_approved' => 1, 'created_at' => now(),
        ]);
    }

    private function confirm(string $email, ?string $dob): array
    {
        $intakeId = (int) DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id' => $this->testTenantId, 'uploaded_by' => $this->coordinatorId, 'status' => 'pending_review',
            'original_filename' => 'f320.pdf', 'stored_path' => 'caring-paper-onboarding/2/f320.pdf',
            'ocr_provider' => 'manual_review_stub', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $fields = ['name' => 'Paper Applicant', 'email' => $email];
        if ($dob !== null) {
            $fields['date_of_birth'] = $dob;
        }

        return app(PaperOnboardingIntakeService::class)->confirm($this->testTenantId, $intakeId, $this->coordinatorId, $fields);
    }

    public function test_the_validated_date_of_birth_is_stored_on_the_account(): void
    {
        $email = 'f320.adult.' . uniqid() . '@example.test';
        $dob = now()->subYears(40)->format('Y-m-d');

        $result = $this->confirm($email, $dob);

        $this->assertTrue($result['success'] ?? false, 'precondition: the adult form is confirmed');
        $stored = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('date_of_birth');
        $this->assertSame($dob, $stored === null ? null : substr((string) $stored, 0, 10), 'users.date_of_birth must hold the date on the form');
    }

    public function test_a_timestamp_shaped_date_is_stored_as_the_date(): void
    {
        $email = 'f320.iso.' . uniqid() . '@example.test';
        $date = now()->subYears(35)->format('Y-m-d');

        $this->assertTrue($this->confirm($email, $date . 'T00:00:00Z')['success'] ?? false);

        $stored = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('date_of_birth');
        $this->assertSame($date, $stored === null ? null : substr((string) $stored, 0, 10));
    }

    public function test_control_a_form_without_a_date_of_birth_stores_none_and_under_18_is_still_refused(): void
    {
        $email = 'f320.nodob.' . uniqid() . '@example.test';
        $this->assertTrue($this->confirm($email, null)['success'] ?? false);
        $this->assertNull(DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->value('date_of_birth'));

        $minor = 'f320.minor.' . uniqid() . '@example.test';
        $result = $this->confirm($minor, now()->subYears(15)->format('Y-m-d'));
        $this->assertFalse($result['success']);
        $this->assertSame(MinimumAge::DATE_OF_BIRTH_ERROR_CODE, $result['code']);
        $this->assertSame(0, DB::table('users')->where('email', $minor)->count());
    }
}
