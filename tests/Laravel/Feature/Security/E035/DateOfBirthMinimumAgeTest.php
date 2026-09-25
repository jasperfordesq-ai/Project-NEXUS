<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Authorization\MinimumAge;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-160 — nobody can record a date of birth under 18.
 *
 * The platform is for adults aged 18 and over, so a date of birth that would
 * make the member under 18 is refused on every write path that can set one.
 * Re-sending the value already on the account is accepted, because profile
 * forms post the whole profile.
 */
class DateOfBirthMinimumAgeTest extends TestCase
{
    use DatabaseTransactions;

    private function member(?string $dob, array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        DB::table('users')->where('id', $user->id)->update(['date_of_birth' => $dob]);
        TenantContext::setById($this->testTenantId);

        return $user->fresh();
    }

    private function storedDob(User $user): ?string
    {
        $value = DB::table('users')->where('id', $user->id)->value('date_of_birth');

        return $value === null ? null : substr((string) $value, 0, 10);
    }

    private function assertUnderAgeRefusal(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(422);
        $this->assertSame(MinimumAge::DATE_OF_BIRTH_ERROR_CODE, $response->json('errors.0.code'));
        $this->assertSame('date_of_birth', $response->json('errors.0.field'));
        $message = (string) $response->json('errors.0.message');
        $this->assertNotSame('api.date_of_birth_under_minimum_age', $message, 'message must be translated');
        $this->assertStringContainsString('18', $message);
    }

    public function test_profile_update_refuses_a_date_of_birth_under_18(): void
    {
        $user = $this->member(null);
        Sanctum::actingAs($user);

        $this->assertUnderAgeRefusal($this->apiPut('/v2/users/me', [
            'first_name' => 'Young',
            'date_of_birth' => now()->subYears(17)->toDateString(),
        ]));
        $this->assertNull($this->storedDob($user));
        $this->assertNotSame('Young', DB::table('users')->where('id', $user->id)->value('first_name'));
    }

    public function test_profile_update_accepts_an_adult_date_and_the_same_value_again(): void
    {
        $user = $this->member(null);
        Sanctum::actingAs($user);

        $dob = now()->subYears(18)->toDateString();
        $this->apiPut('/v2/users/me', ['date_of_birth' => $dob])->assertStatus(200);
        $this->assertSame($dob, $this->storedDob($user));

        $this->apiPut('/v2/users/me', ['first_name' => 'Same', 'date_of_birth' => $dob])->assertStatus(200);
        $this->assertSame('Same', DB::table('users')->where('id', $user->id)->value('first_name'));
    }

    public function test_profile_update_refuses_a_date_that_is_not_a_real_past_date(): void
    {
        $user = $this->member(null);
        Sanctum::actingAs($user);

        foreach (['2001-02-30', 'not-a-date', now()->addYear()->toDateString()] as $bad) {
            $response = $this->apiPut('/v2/users/me', ['date_of_birth' => $bad]);
            $response->assertStatus(422);
            $this->assertSame('date_of_birth', $response->json('errors.0.field'));
        }
        $this->assertNull($this->storedDob($user));
    }

    public function test_identity_save_dob_refuses_a_date_of_birth_under_18(): void
    {
        $this->enableIdentityVerification();
        $user = $this->member(null);
        Sanctum::actingAs($user);

        $this->assertUnderAgeRefusal($this->apiPost('/v2/identity/save-dob', [
            'date_of_birth' => now()->subYears(17)->toDateString(),
        ]));
        $this->assertNull($this->storedDob($user));

        $adult = now()->subYears(30)->toDateString();
        $this->apiPost('/v2/identity/save-dob', ['date_of_birth' => $adult])->assertStatus(200);
        $this->assertSame($adult, $this->storedDob($user));
    }

    public function test_the_shared_validator_accepts_resending_the_stored_value(): void
    {
        $stored = now()->subYears(30)->toDateString();
        $this->assertNull(MinimumAge::dateOfBirthError($stored, $stored));
        $this->assertNull(MinimumAge::dateOfBirthError($stored . 'T00:00:00Z', $stored));
        $this->assertSame(
            MinimumAge::DATE_OF_BIRTH_ERROR_CODE,
            MinimumAge::dateOfBirthError(now()->subYears(10)->toDateString(), $stored)['code'] ?? null,
        );
    }

    private function enableIdentityVerification(): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($row && !empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            if (is_array($decoded)) {
                $features = $decoded;
            }
        }
        $features['identity_verification'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }
}
