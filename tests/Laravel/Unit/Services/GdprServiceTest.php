<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\Enterprise\GdprService;
use App\Services\Enterprise\LoggerService;
use App\Services\Enterprise\MetricsService;

/**
 * GdprService Tests
 *
 * Tests GDPR compliance functionality including:
 * - Data export generation (user data collection, format)
 * - Deletion request processing (anonymization, cascade)
 * - Consent tracking (record, update, withdraw)
 * - Right to portability (JSON/CSV export format)
 * - Tenant-scoped data handling
 * - Edge cases: non-existent user, already deleted, partial data
 * - Data breach reporting
 * - Audit logging
 *
 * @covers \App\Services\Enterprise\GdprService
 */
class GdprServiceTest extends \Tests\Laravel\TestCase
{
    private GdprService $service;
    private \PDO $mockPdo;
    private \PDOStatement $mockStmt;

    protected function setUp(): void
    {
        parent::setUp();

        // Mock PDO and PDOStatement
        $this->mockStmt = $this->createMock(\PDOStatement::class);
        $this->mockPdo = $this->createMock(\PDO::class);

        // Default: prepare returns our mock statement
        $this->mockPdo->method('prepare')->willReturn($this->mockStmt);
        $this->mockStmt->method('execute')->willReturn(true);

        // Use reflection to inject mock PDO into the service
        // GdprService constructor calls Database::getInstance(), so we create with tenant 99
        // then replace $db via reflection
        $this->service = $this->createServiceWithMockDb(99);
    }

    /**
     * Create a GdprService with a mocked PDO connection
     */
    private function createServiceWithMockDb(int $tenantId): GdprService
    {
        // We need to bypass the constructor's Database::getInstance() call.
        // Use reflection to create an uninitialized instance and set properties manually.
        $ref = new \ReflectionClass(GdprService::class);
        $service = $ref->newInstanceWithoutConstructor();

        // Set private properties
        $dbProp = $ref->getProperty('db');
        $dbProp->setAccessible(true);
        $dbProp->setValue($service, $this->mockPdo);

        $tenantProp = $ref->getProperty('tenantId');
        $tenantProp->setAccessible(true);
        $tenantProp->setValue($service, $tenantId);

        // Set logger and metrics via reflection (they are required but we stub them)
        $loggerProp = $ref->getProperty('logger');
        $loggerProp->setAccessible(true);

        $metricsProp = $ref->getProperty('metrics');
        $metricsProp->setAccessible(true);

        // Create mock logger (must match typed property LoggerService)
        $mockLogger = $this->createMock(LoggerService::class);
        $loggerProp->setValue($service, $mockLogger);

        // Create mock metrics (must match typed property MetricsService)
        $mockMetrics = $this->createMock(MetricsService::class);
        $metricsProp->setValue($service, $mockMetrics);

        return $service;
    }

    // =========================================================================
    // CLASS STRUCTURE TESTS
    // =========================================================================

    public function testClassExists(): void
    {
        $this->assertTrue(class_exists(GdprService::class));
    }

    public function testPublicMethodsExist(): void
    {
        $methods = [
            'createRequest',
            'getRequest',
            'getPendingRequests',
            'getUserRequests',
            'processRequest',
            'generateDataExport',
            'executeAccountDeletion',
            'recordConsent',
            'withdrawConsent',
            'getUserConsents',
            'hasConsent',
            'hasCurrentVersionConsent',
            'getOutdatedRequiredConsents',
            'needsReConsent',
            'acceptMultipleConsents',
            'reportBreach',
            'getBreachDeadline',
            'logAction',
            'getAuditLog',
            'getStatistics',
            'getConsentTypes',
            'getActiveConsentTypes',
            'updateUserConsent',
            'backfillConsentsForExistingUsers',
            'getEffectiveConsentVersion',
            'setTenantConsentVersion',
            'removeTenantConsentOverride',
            'getTenantConsentOverrides',
        ];

        foreach ($methods as $method) {
            $this->assertTrue(
                method_exists(GdprService::class, $method),
                "Method {$method} should exist on GdprService"
            );
        }
    }

    // =========================================================================
    // CREATE REQUEST TESTS
    // =========================================================================

    public function testCreateRequestWithValidType(): void
    {
        // No existing pending request
        $this->mockStmt->method('fetch')->willReturnOnConsecutiveCalls(
            false // No existing request
        );
        $this->mockPdo->method('lastInsertId')->willReturn('42');

        $result = $this->service->createRequest(1, 'access');

        $this->assertArrayHasKey('id', $result);
        $this->assertEquals(42, $result['id']);
        $this->assertEquals('access', $result['type']);
        $this->assertEquals('pending', $result['status']);
        $this->assertArrayHasKey('verification_token', $result);
        $this->assertEquals(64, strlen($result['verification_token'])); // 32 bytes = 64 hex chars
    }

    public function testCreateRequestWithInvalidTypeThrowsException(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid request type: invalid_type');

        $this->service->createRequest(1, 'invalid_type');
    }

    public function testCreateRequestValidTypes(): void
    {
        $validTypes = ['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'];

        foreach ($validTypes as $type) {
            // Reset mocks for each type
            $service = $this->createServiceWithMockDb(99);

            $this->mockStmt->method('fetch')->willReturn(false); // No existing request
            $this->mockPdo->method('lastInsertId')->willReturn('1');

            // Should not throw
            $result = $service->createRequest(1, $type);
            $this->assertEquals($type, $result['type']);
        }
    }

    public function testCreateRequestThrowsWhenDuplicatePending(): void
    {
        $this->mockStmt->method('fetch')->willReturn(['id' => 5]); // Existing pending request

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('already have a pending access request');

        $this->service->createRequest(1, 'access');
    }

    public function testCreateRequestWithPriorityOption(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);
        $this->mockPdo->method('lastInsertId')->willReturn('10');

        $result = $this->service->createRequest(1, 'erasure', ['priority' => 'urgent']);

        $this->assertEquals(10, $result['id']);
        $this->assertEquals('erasure', $result['type']);
    }

    // =========================================================================
    // GET REQUEST TESTS
    // =========================================================================

    public function testGetRequestReturnsData(): void
    {
        $expectedData = [
            'id' => 1,
            'user_id' => 10,
            'tenant_id' => 99,
            'request_type' => 'access',
            'status' => 'pending',
        ];

        $this->mockStmt->method('fetch')->willReturn($expectedData);

        $result = $this->service->getRequest(1);

        $this->assertNotNull($result);
        $this->assertEquals(1, $result['id']);
        $this->assertEquals('access', $result['request_type']);
    }

    public function testGetRequestReturnsNullForNonExistent(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $result = $this->service->getRequest(9999);

        $this->assertNull($result);
    }

    // =========================================================================
    // GET USER REQUESTS TESTS
    // =========================================================================

    public function testGetUserRequestsReturnsArray(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['id' => 1, 'request_type' => 'access', 'status' => 'completed'],
            ['id' => 2, 'request_type' => 'erasure', 'status' => 'pending'],
        ]);

        $result = $this->service->getUserRequests(10);

        $this->assertIsArray($result);
        $this->assertCount(2, $result);
    }

    public function testGetUserRequestsReturnsEmptyForNewUser(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([]);

        $result = $this->service->getUserRequests(9999);

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    // =========================================================================
    // PROCESS REQUEST TESTS
    // =========================================================================

    public function testProcessRequestReturnsTrueForExistingRequest(): void
    {
        $this->mockStmt->method('fetch')->willReturn([
            'id' => 1,
            'user_id' => 10,
            'request_type' => 'access',
            'status' => 'pending',
        ]);

        $result = $this->service->processRequest(1, 100);

        $this->assertTrue($result);
    }

    public function testProcessRequestReturnsFalseForNonExistent(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $result = $this->service->processRequest(9999, 100);

        $this->assertFalse($result);
    }

    // =========================================================================
    // CONSENT MANAGEMENT TESTS
    // =========================================================================

    public function testRecordConsentReturnsConsentData(): void
    {
        $result = $this->service->recordConsent(1, 'marketing', true, 'I consent to marketing emails', '1.0');

        $this->assertArrayHasKey('consent_type', $result);
        $this->assertArrayHasKey('consent_given', $result);
        $this->assertArrayHasKey('version', $result);
        $this->assertEquals('marketing', $result['consent_type']);
        $this->assertTrue($result['consent_given']);
        $this->assertEquals('1.0', $result['version']);
    }

    public function testRecordConsentWithdrawn(): void
    {
        $result = $this->service->recordConsent(1, 'marketing', false, 'I consent to marketing emails', '1.0');

        $this->assertFalse($result['consent_given']);
    }

    public function testWithdrawConsentReturnsTrueWhenWithdrawn(): void
    {
        $this->mockStmt->method('rowCount')->willReturn(1);

        $result = $this->service->withdrawConsent(1, 'marketing');

        $this->assertTrue($result);
    }

    public function testWithdrawConsentReturnsFalseWhenNothingToWithdraw(): void
    {
        $this->mockStmt->method('rowCount')->willReturn(0);

        $result = $this->service->withdrawConsent(1, 'nonexistent');

        $this->assertFalse($result);
    }

    public function testGetUserConsentsReturnsArray(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['consent_type_slug' => 'terms', 'consent_given' => 1, 'consent_version' => '2.0'],
            ['consent_type_slug' => 'marketing', 'consent_given' => 0, 'consent_version' => '1.0'],
        ]);

        $result = $this->service->getUserConsents(1);

        $this->assertIsArray($result);
        $this->assertCount(2, $result);
    }

    public function testHasConsentReturnsTrueWhenGiven(): void
    {
        $this->mockStmt->method('fetch')->willReturn(['consent_given' => 1]);

        $result = $this->service->hasConsent(1, 'terms');

        $this->assertTrue($result);
    }

    public function testHasConsentReturnsFalseWhenNotGiven(): void
    {
        $this->mockStmt->method('fetch')->willReturn(['consent_given' => 0]);

        $result = $this->service->hasConsent(1, 'marketing');

        $this->assertFalse($result);
    }

    public function testHasConsentReturnsFalseWhenNoRecord(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $result = $this->service->hasConsent(1, 'nonexistent');

        $this->assertFalse($result);
    }

    // =========================================================================
    // CONSENT VERSION TESTS
    // =========================================================================

    public function testHasCurrentVersionConsentReturnsTrueForCurrentVersion(): void
    {
        $this->mockStmt->method('fetch')->willReturn([
            'consent_version' => '2.0',
            'current_version' => '2.0',
        ]);

        $result = $this->service->hasCurrentVersionConsent(1, 'terms');

        $this->assertTrue($result);
    }

    public function testHasCurrentVersionConsentReturnsFalseForOutdatedVersion(): void
    {
        $this->mockStmt->method('fetch')->willReturn([
            'consent_version' => '1.0',
            'current_version' => '2.0',
        ]);

        $result = $this->service->hasCurrentVersionConsent(1, 'terms');

        $this->assertFalse($result);
    }

    public function testHasCurrentVersionConsentReturnsFalseWhenNoConsent(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $result = $this->service->hasCurrentVersionConsent(1, 'terms');

        $this->assertFalse($result);
    }

    public function testNeedsReConsentReturnsTrueWhenOutdated(): void
    {
        // The method calls getOutdatedRequiredConsents internally which calls query twice per type
        // First call: get required consent types
        $this->mockStmt->method('fetchAll')->willReturn([
            ['slug' => 'terms', 'name' => 'Terms', 'description' => 'Terms of Service',
             'current_version' => '2.0', 'current_text' => 'text', 'category' => 'legal', 'has_tenant_override' => null],
        ]);

        // Second call: check user's consent version
        $this->mockStmt->method('fetch')->willReturn([
            'consent_version' => '1.0',
            'consent_given' => 1,
        ]);

        $result = $this->service->needsReConsent(1);

        $this->assertTrue($result);
    }

    public function testNeedsReConsentReturnsFalseWhenUpToDate(): void
    {
        // No required consent types that need updating
        $this->mockStmt->method('fetchAll')->willReturn([
            ['slug' => 'terms', 'name' => 'Terms', 'description' => 'Terms of Service',
             'current_version' => '2.0', 'current_text' => 'text', 'category' => 'legal', 'has_tenant_override' => null],
        ]);

        $this->mockStmt->method('fetch')->willReturn([
            'consent_version' => '2.0',
            'consent_given' => 1,
        ]);

        $result = $this->service->needsReConsent(1);

        $this->assertFalse($result);
    }

    // =========================================================================
    // TENANT CONSENT OVERRIDE TESTS
    // =========================================================================

    public function testGetEffectiveConsentVersionReturnsData(): void
    {
        $this->mockStmt->method('fetch')->willReturn([
            'slug' => 'terms',
            'name' => 'Terms of Service',
            'description' => 'Platform Terms',
            'is_required' => 1,
            'current_version' => '3.0',
            'current_text' => 'Tenant-specific text',
            'tenant_override_id' => 5,
        ]);

        $result = $this->service->getEffectiveConsentVersion('terms');

        $this->assertNotNull($result);
        $this->assertEquals('terms', $result['slug']);
        $this->assertEquals('3.0', $result['current_version']);
    }

    public function testGetEffectiveConsentVersionReturnsNullForInvalid(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $result = $this->service->getEffectiveConsentVersion('nonexistent');

        $this->assertNull($result);
    }

    public function testSetTenantConsentVersionThrowsForInvalidType(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid consent type: nonexistent');

        $this->service->setTenantConsentVersion('nonexistent', '1.0');
    }

    public function testSetTenantConsentVersionReturnsTrueForValidType(): void
    {
        $this->mockStmt->method('fetch')->willReturn(['1' => 1]);

        $result = $this->service->setTenantConsentVersion('terms', '2.0', 'Updated text');

        $this->assertTrue($result);
    }

    public function testRemoveTenantConsentOverrideReturnsTrue(): void
    {
        $result = $this->service->removeTenantConsentOverride('terms');

        $this->assertTrue($result);
    }

    // =========================================================================
    // BACKFILL CONSENT TESTS
    // =========================================================================

    public function testBackfillConsentsReturnsCount(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['id' => 10],
            ['id' => 20],
            ['id' => 30],
        ]);

        $result = $this->service->backfillConsentsForExistingUsers('terms', '1.0', 'Terms text');

        $this->assertEquals(3, $result);
    }

    public function testBackfillConsentsReturnsZeroWhenAllHaveRecords(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([]);

        $result = $this->service->backfillConsentsForExistingUsers('terms', '1.0', 'Terms text');

        $this->assertEquals(0, $result);
    }

    // =========================================================================
    // DATA BREACH TESTS
    // =========================================================================

    public function testReportBreachReturnsId(): void
    {
        $this->mockPdo->method('lastInsertId')->willReturn('7');

        $result = $this->service->reportBreach([
            'breach_type' => 'unauthorized_access',
            'severity' => 'high',
            'description' => 'Unauthorized access to user data detected.',
            'data_categories' => ['personal', 'financial'],
            'records_affected' => 150,
            'users_affected' => 50,
        ], 100);

        $this->assertEquals(7, $result);
    }

    public function testGetBreachDeadlineReturns72HoursAfterDetection(): void
    {
        $detectedAt = '2026-02-19 10:00:00';
        $this->mockStmt->method('fetch')->willReturn(['detected_at' => $detectedAt]);

        $deadline = $this->service->getBreachDeadline(1);

        $expected = new \DateTime('2026-02-22 10:00:00');
        $this->assertEquals($expected, $deadline);
    }

    // =========================================================================
    // AUDIT LOG TESTS
    // =========================================================================

    public function testGetAuditLogReturnsArray(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['action' => 'data_exported', 'entity_type' => 'gdpr_export', 'created_at' => '2026-02-19'],
            ['action' => 'consent_given', 'entity_type' => 'consent', 'created_at' => '2026-02-18'],
        ]);

        $result = $this->service->getAuditLog(1);

        $this->assertIsArray($result);
        $this->assertCount(2, $result);
    }

    // =========================================================================
    // STATISTICS TESTS
    // =========================================================================

    public function testGetStatisticsReturnsExpectedKeys(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([]);
        $this->mockStmt->method('fetch')->willReturn(['count' => 0, 'avg_hours' => null, 'on_time' => 0, 'judged' => 0]);

        $result = $this->service->getStatistics();

        $this->assertArrayHasKey('requests', $result);
        $this->assertArrayHasKey('pending_count', $result);
        $this->assertArrayHasKey('avg_processing_time', $result);
        $this->assertArrayHasKey('consents', $result);
        $this->assertArrayHasKey('active_breaches', $result);
        $this->assertArrayHasKey('overdue_count', $result);
        // The real-database checks of these figures are in
        // Tests\Laravel\Unit\Services\Enterprise\GdprServiceTest.
        $this->assertArrayHasKey('compliance_score', $result);
        $this->assertArrayHasKey('consent_coverage_percent', $result);
    }

    // =========================================================================
    // CONSENT TYPES TESTS
    // =========================================================================

    public function testGetConsentTypesReturnsArray(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['slug' => 'terms', 'name' => 'Terms', 'is_required' => 1],
            ['slug' => 'marketing', 'name' => 'Marketing', 'is_required' => 0],
        ]);

        $result = $this->service->getConsentTypes();

        $this->assertIsArray($result);
        $this->assertCount(2, $result);
    }

    public function testGetActiveConsentTypesReturnsArray(): void
    {
        $this->mockStmt->method('fetchAll')->willReturn([
            ['slug' => 'terms', 'name' => 'Terms'],
        ]);

        $result = $this->service->getActiveConsentTypes();

        $this->assertIsArray($result);
    }

    // =========================================================================
    // UPDATE USER CONSENT TESTS
    // =========================================================================

    public function testUpdateUserConsentThrowsForInvalidSlug(): void
    {
        $this->mockStmt->method('fetch')->willReturn(false);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid consent type: nonexistent');

        $this->service->updateUserConsent(1, 'nonexistent', true);
    }

    public function testUpdateUserConsentThrowsWhenWithdrawingRequired(): void
    {
        $this->mockStmt->method('fetch')->willReturn([
            'slug' => 'terms',
            'name' => 'Terms of Service',
            'is_required' => 1,
            'current_version' => '1.0',
            'current_text' => 'Terms text',
            'tenant_override_id' => null,
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Cannot withdraw required consent');

        $this->service->updateUserConsent(1, 'terms', false);
    }

    // =========================================================================
    // TENANT ISOLATION TESTS
    // =========================================================================

    public function testServiceUsesTenantIdInQueries(): void
    {
        $ref = new \ReflectionClass($this->service);
        $tenantProp = $ref->getProperty('tenantId');
        $tenantProp->setAccessible(true);

        $this->assertEquals(99, $tenantProp->getValue($this->service));
    }

    public function testDifferentTenantsGetDifferentServiceInstances(): void
    {
        $service1 = $this->createServiceWithMockDb(1);
        $service2 = $this->createServiceWithMockDb(2);

        $ref = new \ReflectionClass(GdprService::class);
        $tenantProp = $ref->getProperty('tenantId');
        $tenantProp->setAccessible(true);

        $this->assertEquals(1, $tenantProp->getValue($service1));
        $this->assertEquals(2, $tenantProp->getValue($service2));
    }

    // =========================================================================
    // COLLECT USER DATA STRUCTURE TESTS
    // =========================================================================

    public function testCollectUserDataMethodExists(): void
    {
        $ref = new \ReflectionClass(GdprService::class);
        $this->assertTrue($ref->hasMethod('collectUserData'));

        $method = $ref->getMethod('collectUserData');
        $this->assertTrue($method->isPrivate());
    }

    public function testCollectUserDataSections(): void
    {
        // Use reflection to call the private method
        $ref = new \ReflectionClass(GdprService::class);
        $method = $ref->getMethod('collectUserData');
        $method->setAccessible(true);

        // Mock various data return values
        $this->mockStmt->method('fetch')->willReturn(null);
        $this->mockStmt->method('fetchAll')->willReturn([]);

        $data = $method->invoke($this->service, 1);

        $this->assertArrayHasKey('export_info', $data);
        $this->assertArrayHasKey('profile', $data);
        $this->assertArrayHasKey('listings', $data);
        $this->assertArrayHasKey('messages', $data);
        $this->assertArrayHasKey('transactions', $data);
        $this->assertArrayHasKey('events', $data);
        $this->assertArrayHasKey('groups', $data);
        $this->assertArrayHasKey('volunteering', $data);
        $this->assertArrayHasKey('gamification', $data);
        $this->assertArrayHasKey('activity_log', $data);
        $this->assertArrayHasKey('consents', $data);
        $this->assertArrayHasKey('notifications', $data);
        $this->assertArrayHasKey('connections', $data);
        $this->assertArrayHasKey('login_history', $data);
        $this->assertArrayHasKey('vetting_attestations', $data);
        $this->assertArrayNotHasKey('vetting_records', $data);
    }

    public function testExportInfoContainsRequiredMetadata(): void
    {
        $ref = new \ReflectionClass(GdprService::class);
        $method = $ref->getMethod('collectUserData');
        $method->setAccessible(true);

        $this->mockStmt->method('fetch')->willReturn(null);
        $this->mockStmt->method('fetchAll')->willReturn([]);

        $data = $method->invoke($this->service, 42);

        $exportInfo = $data['export_info'];
        $this->assertArrayHasKey('generated_at', $exportInfo);
        $this->assertEquals(42, $exportInfo['user_id']);
        $this->assertEquals('Project NEXUS', $exportInfo['platform']);
        $this->assertEquals('1.0', $exportInfo['format_version']);
        $this->assertEquals(99, $exportInfo['tenant_id']);
    }

    // =========================================================================
    // HTML EXPORT GENERATION TESTS
    // =========================================================================

    public function testGenerateHtmlExportProducesValidHtml(): void
    {
        $ref = new \ReflectionClass(GdprService::class);
        $method = $ref->getMethod('generateHtmlExport');
        $method->setAccessible(true);

        $data = [
            'export_info' => [
                'generated_at' => '2026-02-19T10:00:00+00:00',
                'user_id' => 1,
                'platform' => 'Project NEXUS',
                'format_version' => '1.0',
                'tenant_id' => 99,
            ],
            'profile' => [
                'id' => 1,
                'email' => 'test@example.com',
                'first_name' => 'Test',
            ],
        ];

        $html = $method->invoke($this->service, $data);

        $this->assertStringContainsString('<!DOCTYPE html>', $html);
        $this->assertStringContainsString('<title>Your Data Export — Project NEXUS</title>', $html);
        $this->assertStringContainsString('2026-02-19T10:00:00+00:00', $html);
        $this->assertStringContainsString('</html>', $html);
    }

    // =========================================================================
    // EXPORT README GENERATION TESTS
    // =========================================================================

    public function testGenerateExportReadmeContainsRequiredInfo(): void
    {
        $ref = new \ReflectionClass(GdprService::class);
        $method = $ref->getMethod('generateExportReadme');
        $method->setAccessible(true);

        $data = [
            'export_info' => [
                'generated_at' => '2026-02-19T10:00:00+00:00',
                'user_id' => 42,
                'platform' => 'Project NEXUS',
            ],
        ];

        $readme = $method->invoke($this->service, $data);

        $this->assertStringContainsString('NEXUS DATA EXPORT', $readme);
        $this->assertStringContainsString('User ID: 42', $readme);
        $this->assertStringContainsString('data.json', $readme);
        $this->assertStringContainsString('data.html', $readme);
        $this->assertStringContainsString('expire in 7 days', $readme);
    }

    // =========================================================================
    // ACCOUNT DELETION — VOLUNTEERING DATA COVERAGE (2026-06-11 audit)
    // =========================================================================

    /**
     * Regression guard: account deletion previously exported volunteering data
     * but never deleted or anonymized it — sensitive records (credentials,
     * wellbeing, accessibility needs, guardian PII, donor name/email) survived
     * GDPR erasure. This source-coverage test fails if the volunteering
     * erasure block is ever removed from executeAccountDeletion().
     */
    public function testAccountDeletionCoversVolunteeringTables(): void
    {
        $src = file_get_contents(app_path('Services/Enterprise/GdprService.php'));
        $start = strpos($src, 'function executeAccountDeletion');
        $this->assertNotFalse($start, 'executeAccountDeletion not found');
        $deletionSrc = substr($src, $start);

        $required = [
            // Hard deletes — sensitive personal records
            'DELETE FROM vol_credentials',
            'DELETE FROM vol_mood_checkins',
            'DELETE FROM vol_wellbeing_alerts',
            'DELETE FROM vol_accessibility_needs',
            'DELETE FROM vol_guardian_consents',
            'DELETE FROM vol_safeguarding_training',
            'DELETE FROM vol_certificates',
            'DELETE FROM vol_shift_waitlist',
            'DELETE FROM vol_emergency_alert_recipients',
            'DELETE FROM vol_shift_checkins',
            'DELETE FROM vol_reviews',
            'DELETE FROM vol_custom_field_values',
            // Anonymization — records kept for org accounting
            'UPDATE vol_donations SET donor_name = NULL, donor_email = NULL',
            'UPDATE vol_applications SET message = NULL, org_note = NULL',
            'UPDATE vol_logs SET description = NULL, feedback = NULL',
            'UPDATE vol_expenses SET description = NULL',
            // Anonymization — two-party / shared records retained with the
            // erased user's free-text scrubbed (2026-07-08 audit): swap
            // requests keep the counterparty's history, supporter rows keep
            // project supporter counts honest, group reservations keep the
            // group's capacity booking. Gift-aid declarations are scrubbed
            // unless an HMRC claim was submitted (legal-obligation carve-out).
            'UPDATE vol_shift_swap_requests SET message = NULL',
            'UPDATE vol_community_project_supporters SET message = NULL',
            'UPDATE vol_shift_group_reservations SET notes = NULL',
            "gift_aid_claim_status NOT IN ('claimed', 'refund_after_claim')",
        ];

        foreach ($required as $needle) {
            $this->assertStringContainsString(
                $needle,
                $deletionSrc,
                "GDPR account deletion lost volunteering coverage: {$needle}"
            );
        }

        // 2026-06-17 audit: uploaded credential documents (vetting/Garda scans,
        // ID PDFs) must be deleted from disk before the vol_credentials rows —
        // otherwise identity-bearing PII files survive Article 17 erasure.
        $this->assertStringContainsString(
            'SELECT id, file_url FROM vol_credentials',
            $deletionSrc,
            'GDPR erasure no longer reads credential file paths for on-disk deletion'
        );
        $this->assertStringContainsString(
            'deletePrivateCredentialPointer(',
            $deletionSrc,
            'GDPR erasure no longer deletes uploaded credential files from disk'
        );
    }

    /**
     * Regression guard for the 2026-06-12 Fable hunt: account erasure was
     * missing job applications (CVs!), stories, marketplace seller identity,
     * poll votes, goals, feed comments, course history, voice-message files
     * and used a colliding shared anonymized email in email_log.
     */
    public function testAccountDeletionCoversCrossModuleTables(): void
    {
        $src = file_get_contents(app_path('Services/Enterprise/GdprService.php'));
        $start = strpos($src, 'function executeAccountDeletion');
        $this->assertNotFalse($start, 'executeAccountDeletion not found');
        $deletionSrc = substr($src, $start);

        $required = [
            'DELETE FROM job_vacancy_applications',
            'DELETE FROM job_applications',
            'DELETE FROM stories',
            'DELETE FROM story_reactions',
            'DELETE FROM marketplace_seller_profiles',
            'UPDATE marketplace_orders SET delivery_notes = NULL, delivery_address = NULL',
            'UPDATE marketplace_offers SET message = NULL, counter_message = NULL',
            'DELETE FROM poll_votes',
            'DELETE FROM poll_rankings',
            'DELETE FROM goal_checkins',
            'DELETE FROM goals',
            'DELETE FROM feed_comments',
            'DELETE FROM course_quiz_attempts',
            'DELETE FROM course_enrollments',
            'voice_messages',
            '@anonymized.local',
            // Compliance copies — the users row is anonymized (not deleted),
            // so CASCADE FKs never fire; explicit deletes are required.
            'DELETE FROM vetting_records',
            'DELETE FROM insurance_certificates',
            'DELETE FROM identity_verification_sessions',
        ];

        foreach ($required as $needle) {
            $this->assertStringContainsString(
                $needle,
                $deletionSrc,
                "GDPR account deletion lost cross-module coverage: {$needle}"
            );
        }

        $this->assertStringNotContainsString(
            "SET recipient_email = 'deleted@anonymized.local'",
            $deletionSrc,
            'email_log anonymization must use a unique per-user address, not a shared one'
        );
    }

    /**
     * Regression guard (2026-07-04): the erasure steps for 2FA and exchange notes
     * targeted columns that do not exist in the real schema
     * (users.totp_secret / totp_backup_codes; exchange_requests.provider_notes),
     * so each UPDATE threw and the swallowing try/catch hid it — the encrypted
     * TOTP secret and the exchange free-text survived Article 17 erasure. Lock the
     * corrected column set so the drift cannot silently return.
     */
    public function testAccountDeletionUsesRealTotpAndExchangeColumns(): void
    {
        $src = file_get_contents(app_path('Services/Enterprise/GdprService.php'));
        $start = strpos($src, 'function executeAccountDeletion');
        $this->assertNotFalse($start, 'executeAccountDeletion not found');
        $deletionSrc = substr($src, $start);

        // TOTP: erase the real store, not the phantom users columns.
        $this->assertStringContainsString('DELETE FROM user_totp_settings', $deletionSrc);
        $this->assertStringContainsString('DELETE FROM user_trusted_devices', $deletionSrc);
        $this->assertStringNotContainsString(
            'SET totp_secret = NULL',
            $deletionSrc,
            'erasure must not write the non-existent users.totp_secret column'
        );
        $this->assertStringNotContainsString(
            'totp_backup_codes',
            $deletionSrc,
            'erasure must not reference the non-existent users.totp_backup_codes column'
        );

        // Exchange notes: clear the columns that exist; provider_notes does not.
        $this->assertStringContainsString('requester_notes = NULL, broker_notes = NULL', $deletionSrc);
        $this->assertStringNotContainsString(
            'provider_notes = NULL',
            $deletionSrc,
            'exchange_requests has no provider_notes column — referencing it fails the whole UPDATE'
        );
    }
}
