<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Checking a volunteer certificate without an account — by code AND name.
 *
 * Gap C1 of the volunteering journey walk (6 Oct 2026): certificates say they
 * "can be verified online", but the only check sat behind sign-in (deliberately,
 * since July: it reveals a member's identity). Owner decision, 6 Oct 2026: an
 * employer enters the code and the name printed on the certificate, and is only
 * told whether they match. A code alone reveals nothing — a wrong name and an
 * unknown code get the same answer — and the signed-in GET stays as it was.
 */
class VolunteerCertificateCheckTest extends TestCase
{
    use DatabaseTransactions;

    private const CODE = 'CHECKC1CODE00001';

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $holder = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'name' => 'Ada Lovelace',
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('vol_certificates')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $holder->id,
            'verification_code' => self::CODE,
            'total_hours' => 24.5,
            'date_range_start' => '2026-03-01',
            'date_range_end' => '2026-06-30',
            'organizations' => json_encode([['name' => 'Food Bank', 'hours' => 24.5]]),
            'generated_at' => now(),
        ]);
    }

    private function check(array $body): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/volunteering/certificates/check', $body);
    }

    public function test_the_right_code_and_name_confirm_what_the_certificate_says(): void
    {
        $response = $this->check(['code' => self::CODE, 'name' => 'Ada Lovelace'])->assertOk();

        $response->assertJsonPath('data.valid', true)
            ->assertJsonPath('data.name', 'Ada Lovelace')
            ->assertJsonPath('data.total_hours', 24.5)
            ->assertJsonPath('data.date_range.start', '2026-03-01')
            ->assertJsonPath('data.date_range.end', '2026-06-30')
            ->assertJsonPath('data.organizations.0.name', 'Food Bank');
        $this->assertArrayNotHasKey('id', $response->json('data'));
        $this->assertArrayNotHasKey('user_id', $response->json('data'));
    }

    public function test_the_name_matches_regardless_of_case_spacing_and_accents(): void
    {
        DB::table('users')->where('first_name', 'Ada')->where('tenant_id', $this->testTenantId)
            ->update(['first_name' => 'Adá']);

        $this->check(['code' => strtolower(self::CODE), 'name' => '  ada   LOVELACE '])
            ->assertOk()
            ->assertJsonPath('data.valid', true);
    }

    public function test_a_wrong_name_and_an_unknown_code_get_the_same_answer(): void
    {
        $wrongName = $this->check(['code' => self::CODE, 'name' => 'Grace Hopper'])->assertOk()->json();
        $unknownCode = $this->check(['code' => 'NOPE000000000000', 'name' => 'Ada Lovelace'])->assertOk()->json();

        $this->assertSame(['valid' => false], $wrongName['data']);
        $this->assertSame($wrongName, $unknownCode, 'nothing distinguishes a real code from an unknown one');
    }

    public function test_another_communitys_certificate_does_not_match(): void
    {
        DB::table('vol_certificates')->where('verification_code', self::CODE)->update(['tenant_id' => 999]);

        $this->check(['code' => self::CODE, 'name' => 'Ada Lovelace'])
            ->assertOk()
            ->assertJsonPath('data.valid', false);
    }

    public function test_both_the_code_and_the_name_are_required(): void
    {
        $this->check(['code' => self::CODE])->assertStatus(422);
        $this->check(['name' => 'Ada Lovelace'])->assertStatus(422);
    }

    public function test_the_signed_in_lookup_still_refuses_anonymous_callers(): void
    {
        $this->apiGet('/v2/volunteering/certificates/verify/' . self::CODE)->assertUnauthorized();
    }

    public function test_the_certificate_links_to_the_public_check_page(): void
    {
        $url = \App\Services\VolunteerCertificateService::verify(self::CODE)['verification_url'] ?? '';
        $this->assertStringEndsWith('/verify-certificate/' . self::CODE, $url);
        $this->assertStringNotContainsString('/api/', $url);
    }
}
