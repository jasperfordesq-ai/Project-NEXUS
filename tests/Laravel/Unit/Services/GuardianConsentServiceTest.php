<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GuardianConsentService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class GuardianConsentServiceTest extends TestCase
{
    // =========================================================================
    // isMinor()
    // =========================================================================

    public function test_isMinor_returns_false_when_no_dob(): void
    {
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) ['date_of_birth' => null]);

        $this->assertFalse(GuardianConsentService::isMinor(1));
    }

    public function test_isMinor_returns_true_for_minor(): void
    {
        // 10 years old
        $dob = (new \DateTime())->modify('-10 years')->format('Y-m-d');
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) ['date_of_birth' => $dob]);

        $this->assertTrue(GuardianConsentService::isMinor(1));
    }

    public function test_isMinor_returns_false_for_adult(): void
    {
        // 25 years old
        $dob = (new \DateTime())->modify('-25 years')->format('Y-m-d');
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) ['date_of_birth' => $dob]);

        $this->assertFalse(GuardianConsentService::isMinor(1));
    }

    public function test_isMinor_returns_false_on_exception(): void
    {
        DB::shouldReceive('table->where->where->select->first')->andThrow(new \Exception('error'));

        $this->assertFalse(GuardianConsentService::isMinor(1));
    }

    // =========================================================================
    // requestConsent()
    // =========================================================================

    public function test_requestConsent_throws_for_missing_guardian_name(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Guardian name is required');

        GuardianConsentService::requestConsent(1, [
            'guardian_email' => 'g@example.com',
            'relationship' => 'parent',
        ]);
    }

    public function test_requestConsent_throws_for_missing_guardian_email(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Guardian email is required');

        GuardianConsentService::requestConsent(1, [
            'guardian_name' => 'Parent',
            'relationship' => 'parent',
        ]);
    }

    public function test_requestConsent_throws_for_invalid_email(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid guardian email');

        GuardianConsentService::requestConsent(1, [
            'guardian_name' => 'Parent',
            'guardian_email' => 'not-an-email',
            'relationship' => 'parent',
        ]);
    }

    public function test_requestConsent_throws_for_invalid_relationship(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid relationship type');

        GuardianConsentService::requestConsent(1, [
            'guardian_name' => 'Parent',
            'guardian_email' => 'g@example.com',
            'relationship' => 'friend',
        ]);
    }

    public function test_requestConsent_throws_when_user_not_minor(): void
    {
        $dob = (new \DateTime())->modify('-25 years')->format('Y-m-d');
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) ['date_of_birth' => $dob]);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('not a minor');

        GuardianConsentService::requestConsent(1, [
            'guardian_name' => 'Parent',
            'guardian_email' => 'g@example.com',
            'relationship' => 'parent',
        ]);
    }

    public function test_requestConsent_returns_consent_record(): void
    {
        $dob = (new \DateTime())->modify('-10 years')->format('Y-m-d');
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) ['date_of_birth' => $dob]);
        DB::shouldReceive('table->where->where->value')->andReturn(null);
        DB::shouldReceive('table->insertGetId')->andReturn(5);

        $result = GuardianConsentService::requestConsent(1, [
            'guardian_name' => 'Parent Name',
            'guardian_email' => 'parent@example.com',
            'relationship' => 'parent',
        ], 10);

        $this->assertEquals(5, $result['id']);
        $this->assertEquals('pending', $result['status']);
        $this->assertEquals('Parent Name', $result['guardian_name']);
        // SECURITY: the consent token must NOT be returned to the requesting minor;
        // it is delivered only to the guardian via email.
        $this->assertArrayNotHasKey('consent_token', $result);
        $this->assertEquals(10, $result['opportunity_id']);
    }

    // =========================================================================
    // grantConsent()
    // =========================================================================

    public function test_grantConsent_returns_false_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->where->first')->andReturn(null);

        $this->assertFalse(GuardianConsentService::grantConsent('invalid_token', '127.0.0.1'));
    }

    public function test_grantConsent_returns_false_when_expired(): void
    {
        $consent = (object) [
            'id' => 1,
            'expires_at' => (new \DateTime())->modify('-1 day')->format('Y-m-d H:i:s'),
        ];
        DB::shouldReceive('table->where->where->where->first')->andReturn($consent);

        $this->assertFalse(GuardianConsentService::grantConsent('token', '127.0.0.1'));
    }

    public function test_grantConsent_succeeds(): void
    {
        $consent = (object) [
            'id' => 1,
            'expires_at' => (new \DateTime())->modify('+30 days')->format('Y-m-d H:i:s'),
        ];
        DB::shouldReceive('table->where->where->where->first')->andReturn($consent);
        DB::shouldReceive('table->where->update')->once();

        $this->assertTrue(GuardianConsentService::grantConsent('valid_token', '127.0.0.1'));
    }

    // =========================================================================
    // withdrawConsent()
    // =========================================================================

    public function test_withdrawConsent_returns_false_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->where->first')->andReturn(null);

        $this->assertFalse(GuardianConsentService::withdrawConsent(999, 1));
    }

    public function test_withdrawConsent_succeeds(): void
    {
        $consent = (object) ['id' => 1, 'minor_user_id' => 5];
        DB::shouldReceive('table->where->where->where->first')->andReturn($consent);
        DB::shouldReceive('table->where->where->update')->once();

        $this->assertTrue(GuardianConsentService::withdrawConsent(1, 5));
    }

    // =========================================================================
    // checkConsent()
    // =========================================================================

    public function test_checkConsent_returns_true_when_active_consent_exists(): void
    {
        DB::shouldReceive('table->where->where->where->where->exists')->andReturn(true);

        $this->assertTrue(GuardianConsentService::checkConsent(1));
    }

    public function test_checkConsent_returns_false_when_no_consent(): void
    {
        DB::shouldReceive('table->where->where->where->where->exists')->andReturn(false);

        $this->assertFalse(GuardianConsentService::checkConsent(1));
    }

    public function test_checkConsent_returns_false_on_error(): void
    {
        DB::shouldReceive('table->where->where->where->where->exists')
            ->andThrow(new \Exception('error'));
        Log::shouldReceive('error')->once();

        $this->assertFalse(GuardianConsentService::checkConsent(1));
    }

    // =========================================================================
    // getConsentsForMinor()
    // =========================================================================

    public function test_getConsentsForMinor_returns_array(): void
    {
        DB::shouldReceive('table->where->where->select->orderByDesc->get->map->toArray')
            ->andReturn([['id' => 1, 'status' => 'active']]);

        $result = GuardianConsentService::getConsentsForMinor(1);
        $this->assertCount(1, $result);
    }

    public function test_getConsentsForMinor_returns_empty_on_error(): void
    {
        DB::shouldReceive('table->where->where->select->orderByDesc->get->map->toArray')
            ->andThrow(new \Exception('error'));
        Log::shouldReceive('error')->once();

        $this->assertEquals([], GuardianConsentService::getConsentsForMinor(1));
    }

    // =========================================================================
    // getConsentStatusByToken()
    // =========================================================================

    public function test_getConsentStatusByToken_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->select->first')->andReturn(null);

        $this->assertNull(GuardianConsentService::getConsentStatusByToken('unknown'));
    }

    public function test_getConsentStatusByToken_reports_pending_token_as_valid(): void
    {
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) [
            'id' => 1,
            'status' => 'pending',
            'expires_at' => (new \DateTime())->modify('+30 days')->format('Y-m-d H:i:s'),
        ]);

        $result = GuardianConsentService::getConsentStatusByToken('token');

        $this->assertSame('pending', $result['status']);
        $this->assertTrue($result['valid']);
    }

    public function test_getConsentStatusByToken_reports_expired_pending_token_as_invalid(): void
    {
        DB::shouldReceive('table->where->where->select->first')->andReturn((object) [
            'id' => 1,
            'status' => 'pending',
            'expires_at' => (new \DateTime())->modify('-1 day')->format('Y-m-d H:i:s'),
        ]);

        $result = GuardianConsentService::getConsentStatusByToken('token');

        $this->assertSame('expired', $result['status']);
        $this->assertFalse($result['valid']);
    }

    // =========================================================================
    // expireOldConsents()
    // =========================================================================

    public function test_expireOldConsents_returns_count(): void
    {
        DB::shouldReceive('table->whereIn->whereNotNull->where->update')->andReturn(3);

        $this->assertEquals(3, GuardianConsentService::expireOldConsents());
    }

    public function test_expireOldConsents_returns_zero_on_error(): void
    {
        DB::shouldReceive('table->whereIn->whereNotNull->where->update')
            ->andThrow(new \Exception('error'));
        Log::shouldReceive('error')->once();

        $this->assertEquals(0, GuardianConsentService::expireOldConsents());
    }
}
