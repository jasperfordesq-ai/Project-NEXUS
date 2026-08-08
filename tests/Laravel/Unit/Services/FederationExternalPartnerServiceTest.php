<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Core\TenantContext;
use App\Services\FederationExternalPartnerService;
use Illuminate\Support\Facades\DB;

/**
 * FederationExternalPartnerService Tests
 *
 * Tests CRUD operations for external federation partners.
 */
class FederationExternalPartnerServiceTest extends \Tests\Laravel\TestCase
{
    protected static ?int $staticTenantId = null;
    protected static ?int $testUserId = null;
    protected static ?int $createdPartnerId = null;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();

        // Boot the Laravel application so facades (DB, Crypt, etc.) are available
        // before any test instance is created. setUpBeforeClass runs before setUp().
        $app = require dirname(__DIR__, 4) . '/bootstrap/app.php';
        $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

        self::$staticTenantId = 2;
        TenantContext::setById(self::$staticTenantId);

        // Create test user for createdBy field
        $timestamp = time();
        DB::insert(
            "INSERT INTO users (tenant_id, email, username, first_name, last_name, name, balance, is_approved, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())",
            [self::$staticTenantId, "ext_partner_test_{$timestamp}@test.com", "ext_partner_test_{$timestamp}", 'Ext', 'Partner', 'Ext Partner', 100]
        );
        self::$testUserId = (int) DB::getPdo()->lastInsertId();
    }

    public static function tearDownAfterClass(): void
    {
        // Clean up created partner if any
        if (self::$createdPartnerId) {
            try {
                DB::delete("DELETE FROM federation_external_partner_logs WHERE partner_id = ?", [self::$createdPartnerId]);
                DB::delete("DELETE FROM federation_external_partners WHERE id = ?", [self::$createdPartnerId]);
            } catch (\Exception $e) {}
        }

        if (self::$testUserId) {
            try {
                DB::delete("DELETE FROM federation_audit_log WHERE actor_user_id = ?", [self::$testUserId]);
                DB::delete("DELETE FROM users WHERE id = ?", [self::$testUserId]);
            } catch (\Exception $e) {}
        }

        parent::tearDownAfterClass();
    }

    /**
     * A base_url the SSRF guard accepts without any DNS lookup.
     *
     * OutboundUrlGuard::isSafeHttpUrl() resolves hostnames via dns_get_record()
     * and rejects the URL when nothing resolves — so any invented hostname
     * fails, and in this container nothing resolves at all. An IP literal skips
     * resolution entirely (resolveHost() returns the literal), so the address
     * below is deterministic everywhere. 203.0.113.0/24 is TEST-NET-3, reserved
     * by RFC 5737 for documentation and never routable, and PHP's
     * FILTER_FLAG_NO_RES_RANGE does not treat it as reserved — so the guard
     * sees it as public. Uniqueness comes from the path, not the host.
     */
    private static function testBaseUrl(string $suffix): string
    {
        return "https://203.0.113.10/partner-{$suffix}";
    }

    // ==========================================
    // getAll Tests
    // ==========================================

    public function testGetAllReturnsArray(): void
    {
        $result = FederationExternalPartnerService::getAll(self::$staticTenantId);
        $this->assertIsArray($result);
    }

    public function testGetAllWithNonExistentTenantReturnsEmptyArray(): void
    {
        $result = FederationExternalPartnerService::getAll(999999);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    // ==========================================
    // getById Tests
    // ==========================================

    public function testGetByIdReturnsNullForNonExistentPartner(): void
    {
        $result = FederationExternalPartnerService::getById(999999, self::$staticTenantId);
        $this->assertNull($result);
    }

    public function testGetByIdReturnsNullForWrongTenant(): void
    {
        $result = FederationExternalPartnerService::getById(1, 999999);
        $this->assertNull($result);
    }

    // ==========================================
    // create / urlExists / delete Tests
    // ==========================================

    public function testCreateAndDeletePartner(): void
    {
        $timestamp = time();
        $baseUrl = self::testBaseUrl("create-delete-{$timestamp}");

        // Create
        $result = FederationExternalPartnerService::create(
            [
                'name' => "Test Partner {$timestamp}",
                'description' => 'A test external partner',
                'base_url' => $baseUrl,
                'api_path' => '/api/v1/federation',
                'api_key' => 'test-api-key-12345',
                'auth_method' => 'api_key',
            ],
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertIsArray($result);
        $this->assertTrue($result['success'], 'create() failed: ' . ($result['error'] ?? 'no error given'));
        $this->assertArrayHasKey('id', $result);

        $partnerId = (int) $result['id'];
        self::$createdPartnerId = $partnerId;

        // urlExists should be true now
        $exists = FederationExternalPartnerService::urlExists($baseUrl, self::$staticTenantId);
        $this->assertTrue($exists);

        // urlExists with excludeId should be false
        $existsExcluded = FederationExternalPartnerService::urlExists($baseUrl, self::$staticTenantId, $partnerId);
        $this->assertFalse($existsExcluded);

        // getById should work
        $partner = FederationExternalPartnerService::getById($partnerId, self::$staticTenantId);
        $this->assertNotNull($partner);
        $this->assertEquals("Test Partner {$timestamp}", $partner['name']);

        // Delete
        $deleteResult = FederationExternalPartnerService::delete($partnerId, self::$staticTenantId, self::$testUserId);
        $this->assertTrue($deleteResult['success']);
        self::$createdPartnerId = null;

        // Verify deleted
        $deleted = FederationExternalPartnerService::getById($partnerId, self::$staticTenantId);
        $this->assertNull($deleted);
    }

    public function testCreateDuplicateUrlFails(): void
    {
        $timestamp = time();
        $baseUrl = self::testBaseUrl("duplicate-{$timestamp}");

        // Create first
        $result1 = FederationExternalPartnerService::create(
            ['name' => 'First Partner', 'base_url' => $baseUrl],
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertTrue($result1['success'], 'create() failed: ' . ($result1['error'] ?? 'no error given'));
        $firstId = (int) $result1['id'];

        try {
            // Try duplicate
            $result2 = FederationExternalPartnerService::create(
                ['name' => 'Duplicate Partner', 'base_url' => $baseUrl],
                self::$staticTenantId,
                self::$testUserId
            );

            $this->assertFalse($result2['success']);
            // create() reports a duplicate base_url with this key — asserted
            // exactly so a change of message is a deliberate decision, not drift.
            $this->assertSame(__('api.external_partner_update_failed'), $result2['error']);
        } finally {
            // Clean up whether or not the assertions above held.
            FederationExternalPartnerService::delete($firstId, self::$staticTenantId, self::$testUserId);
        }
    }

    /**
     * The SSRF guard resolves the host and rejects anything that does not
     * resolve to a public IP — so a made-up hostname can NEVER be stored, in
     * any environment. This is asserted rather than assumed because two tests
     * here previously invented `https://test-partner-<ts>.example.com`, whose
     * subdomain does not exist, and then swallowed the resulting failure as
     * "federation_external_partners table may not exist".
     */
    public function testCreateRejectsHostThatDoesNotResolve(): void
    {
        $result = FederationExternalPartnerService::create(
            ['name' => 'Unresolvable', 'base_url' => 'https://test-partner-' . time() . '.example.com'],
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertFalse($result['success']);
        $this->assertSame(__('api.url_no_private_ip'), $result['error']);
    }

    public function testCreateRejectsPrivateAddress(): void
    {
        $result = FederationExternalPartnerService::create(
            ['name' => 'Private', 'base_url' => 'https://192.168.1.1/federation'],
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertFalse($result['success']);
        $this->assertSame(__('api.url_no_private_ip'), $result['error']);
    }

    // ==========================================
    // update Tests
    // ==========================================

    public function testUpdateNonExistentPartnerFails(): void
    {
        $result = FederationExternalPartnerService::update(
            999999,
            ['name' => 'Updated', 'base_url' => self::testBaseUrl('updated')],
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertFalse($result['success']);
        $this->assertEquals(__('api.external_partner_not_found'), $result['error']);
    }

    // ==========================================
    // updateStatus Tests
    // ==========================================

    public function testUpdateStatusNonExistentPartnerFails(): void
    {
        $result = FederationExternalPartnerService::updateStatus(
            999999,
            'active',
            self::$staticTenantId,
            self::$testUserId
        );

        $this->assertFalse($result['success']);
    }

    // ==========================================
    // getActivePartners Tests
    // ==========================================

    public function testGetActivePartnersReturnsArray(): void
    {
        $result = FederationExternalPartnerService::getActivePartners(self::$staticTenantId);
        $this->assertIsArray($result);
    }

    // ==========================================
    // getActivePartnersForListings Tests
    // ==========================================

    public function testGetActivePartnersForListingsReturnsArray(): void
    {
        $result = FederationExternalPartnerService::getActivePartnersForListings(self::$staticTenantId);
        $this->assertIsArray($result);
    }

    // ==========================================
    // getLogs Tests
    // ==========================================

    public function testGetLogsReturnsArray(): void
    {
        $result = FederationExternalPartnerService::getLogs(999999, 2);
        $this->assertIsArray($result);
    }

    // ==========================================
    // Encryption Tests
    // ==========================================

    public function testDecryptApiKeyRoundTrip(): void
    {
        // Ensure encryption key is available for CI environments
        if (!getenv('APP_KEY') && !getenv('ENCRYPTION_KEY')) {
            putenv('APP_KEY=test-encryption-key-for-ci-only');
        }

        $originalKey = 'test-api-key-' . time();

        // Use reflection to access private encryptApiKey method
        $reflection = new \ReflectionClass(FederationExternalPartnerService::class);

        $encryptMethod = $reflection->getMethod('encryptApiKey');
        $encryptMethod->setAccessible(true);
        $encrypted = $encryptMethod->invoke(null, $originalKey);

        // Decrypt using reflection (method is private)
        $decryptMethod = $reflection->getMethod('decryptApiKey');
        $decryptMethod->setAccessible(true);
        $decrypted = $decryptMethod->invoke(null, $encrypted);

        $this->assertEquals($originalKey, $decrypted);
    }

    public function testEncryptionProducesDifferentOutputs(): void
    {
        // Ensure encryption key is available for CI environments
        if (!getenv('APP_KEY') && !getenv('ENCRYPTION_KEY')) {
            putenv('APP_KEY=test-encryption-key-for-ci-only');
        }

        $key = 'same-key-input';

        $reflection = new \ReflectionClass(FederationExternalPartnerService::class);
        $encryptMethod = $reflection->getMethod('encryptApiKey');
        $encryptMethod->setAccessible(true);

        $encrypted1 = $encryptMethod->invoke(null, $key);
        $encrypted2 = $encryptMethod->invoke(null, $key);

        // Due to random IV, encryptions should differ
        $this->assertNotEquals($encrypted1, $encrypted2);

        // But both should decrypt to the same value
        $decryptMethod = $reflection->getMethod('decryptApiKey');
        $decryptMethod->setAccessible(true);
        $decrypted1 = $decryptMethod->invoke(null, $encrypted1);
        $decrypted2 = $decryptMethod->invoke(null, $encrypted2);
        $this->assertEquals($decrypted1, $decrypted2);
        $this->assertEquals($key, $decrypted1);
    }

    // ==========================================
    // deleteNonExistent Tests
    // ==========================================

    public function testDeleteNonExistentPartnerFails(): void
    {
        $result = FederationExternalPartnerService::delete(999999, self::$staticTenantId, self::$testUserId);
        $this->assertFalse($result['success']);
    }
}
