<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\EmergencyAlertService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class EmergencyAlertServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_A = 2;   // hour-timebank
    private const TENANT_B = 999; // secondary test tenant

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById(self::TENANT_A);
    }

    private function makeUser(int $tenantId, string $email): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'EA',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId . microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_create_and_broadcast_inserts_alert_and_marks_push_sent(): void
    {
        $admin = $this->makeUser(self::TENANT_A, 'eaadm.' . uniqid() . '@example.com');

        $alert = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title'    => 'Storm warning',
            'body'     => 'Severe storm tonight. Stay indoors.',
            'severity' => 'danger',
        ], $admin);

        $this->assertSame('Storm warning', $alert['title']);
        $this->assertSame('danger', $alert['severity']);
        $this->assertSame(1, (int) $alert['is_active']);
        $this->assertSame(1, (int) $alert['push_sent']);
        $this->assertNotNull($alert['sent_at']);

        $row = DB::table('caring_emergency_alerts')->where('id', $alert['id'])->first();
        $this->assertNotNull($row);
        $this->assertSame((int) self::TENANT_A, (int) $row->tenant_id);
        $this->assertSame($admin, (int) $row->created_by);
    }

    public function test_get_active_alerts_excludes_expired_and_inactive(): void
    {
        $admin = $this->makeUser(self::TENANT_A, 'eaa.' . uniqid() . '@example.com');

        $active = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title' => 'Active', 'body' => 'b', 'severity' => 'info',
        ], $admin);

        $expired = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title'      => 'Expired',
            'body'       => 'b',
            'severity'   => 'info',
            'expires_at' => Carbon::now()->subHour()->toDateTimeString(),
        ], $admin);

        $deactivated = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title' => 'Deactivated', 'body' => 'b', 'severity' => 'info',
        ], $admin);
        EmergencyAlertService::deactivate($deactivated['id'], self::TENANT_A);

        $activeAlerts = EmergencyAlertService::getActiveAlerts(self::TENANT_A);
        $ids = array_column($activeAlerts, 'id');

        $this->assertContains($active['id'], $ids);
        $this->assertNotContains($expired['id'], $ids);
        $this->assertNotContains($deactivated['id'], $ids);
    }

    public function test_cross_tenant_isolation_one_tenant_cannot_see_anothers_alerts(): void
    {
        $adminA = $this->makeUser(self::TENANT_A, 'aa.' . uniqid() . '@example.com');
        $adminB = $this->makeUser(self::TENANT_B, 'bb.' . uniqid() . '@example.com');

        $alertA = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title' => 'A only', 'body' => 'b', 'severity' => 'info',
        ], $adminA);
        $alertB = EmergencyAlertService::createAndBroadcast(self::TENANT_B, [
            'title' => 'B only', 'body' => 'b', 'severity' => 'info',
        ], $adminB);

        $aActive = array_column(EmergencyAlertService::getActiveAlerts(self::TENANT_A), 'id');
        $bActive = array_column(EmergencyAlertService::getActiveAlerts(self::TENANT_B), 'id');

        $this->assertContains($alertA['id'], $aActive);
        $this->assertNotContains($alertB['id'], $aActive);
        $this->assertContains($alertB['id'], $bActive);
        $this->assertNotContains($alertA['id'], $bActive);

        // getAlertById must also be tenant-scoped
        $this->assertNull(EmergencyAlertService::getAlertById($alertA['id'], self::TENANT_B));
        $this->assertNull(EmergencyAlertService::getAlertById($alertB['id'], self::TENANT_A));
    }

    public function test_deactivate_is_tenant_scoped_and_does_not_affect_other_tenant(): void
    {
        $adminA = $this->makeUser(self::TENANT_A, 'cc.' . uniqid() . '@example.com');
        $adminB = $this->makeUser(self::TENANT_B, 'dd.' . uniqid() . '@example.com');

        $alertB = EmergencyAlertService::createAndBroadcast(self::TENANT_B, [
            'title' => 'B alert', 'body' => 'b', 'severity' => 'warning',
        ], $adminB);

        // Tenant A tries to deactivate Tenant B's alert — should be a no-op
        EmergencyAlertService::deactivate($alertB['id'], self::TENANT_A);

        $row = DB::table('caring_emergency_alerts')->where('id', $alertB['id'])->first();
        $this->assertSame(1, (int) $row->is_active, 'Tenant A must not be able to deactivate Tenant B alert');
    }

    public function test_update_modifies_mutable_fields(): void
    {
        $admin = $this->makeUser(self::TENANT_A, 'ee.' . uniqid() . '@example.com');
        $alert = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title' => 'Old', 'body' => 'old body', 'severity' => 'info',
        ], $admin);

        $updated = EmergencyAlertService::update($alert['id'], self::TENANT_A, [
            'title'    => 'New title',
            'severity' => 'danger',
        ]);

        $this->assertSame('New title', $updated['title']);
        $this->assertSame('danger', $updated['severity']);
        $this->assertSame('old body', $updated['body']);
    }

    public function test_record_dismissal_increments_counter(): void
    {
        $admin = $this->makeUser(self::TENANT_A, 'ff.' . uniqid() . '@example.com');
        $alert = EmergencyAlertService::createAndBroadcast(self::TENANT_A, [
            'title' => 'Dismiss me', 'body' => 'b', 'severity' => 'info',
        ], $admin);

        EmergencyAlertService::recordDismissal($alert['id'], self::TENANT_A);
        EmergencyAlertService::recordDismissal($alert['id'], self::TENANT_A);

        $count = (int) DB::table('caring_emergency_alerts')
            ->where('id', $alert['id'])
            ->value('dismissed_count');
        $this->assertSame(2, $count);
    }
}
