<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Verein;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Services\Verein\VereinFederationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class MunicipalityCalendarTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = DB::table('tenants')->where('id', self::TENANT_ID)->first();
        $features = is_array(json_decode((string) ($tenant->features ?? '[]'), true)) ? json_decode((string) $tenant->features, true) : [];
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT_ID)->update(['features' => json_encode($features)]);
        TenantContext::setById(self::TENANT_ID);
    }

    private function makeUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'first_name' => 'C',
            'last_name' => 'U',
            'email' => 'mc' . uniqid() . '@x.test',
            'username' => 'mc_' . substr(md5(uniqid()), 0, 8),
            'password' => password_hash('x', PASSWORD_BCRYPT),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeVerein(int $ownerId, string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $ownerId,
            'name' => $name,
            'slug' => strtolower($name) . '-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    private function makeGroup(
        int $ownerId,
        string $visibility,
        GroupStatus $status = GroupStatus::Active,
        ?int $tenantId = null,
    ): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId ?? self::TENANT_ID,
            'owner_id' => $ownerId,
            'name' => 'Municipality calendar ' . $visibility . ' group ' . uniqid(),
            'slug' => 'municipality-calendar-' . $visibility . '-' . uniqid(),
            'visibility' => $visibility,
            'status' => $status->value,
            'is_active' => $status->legacyIsActive() ? 1 : 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeEvent(int $userId, string $title, ?int $groupId = null): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $userId,
            'group_id' => $groupId,
            'title' => $title,
            'description' => 'd',
            'start_time' => now()->addDays(3),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 0,
            'created_at' => now(),
        ]);
    }

    public function test_calendar_includes_consenting_vereine_excludes_non_consenting(): void
    {
        $svc = app(VereinFederationService::class);

        $ownerA = $this->makeUser();
        $ownerB = $this->makeUser();
        $ownerC = $this->makeUser();
        $ownerD = $this->makeUser();

        $a = $this->makeVerein($ownerA, 'Calendar A');
        $b = $this->makeVerein($ownerB, 'Calendar B');
        $c = $this->makeVerein($ownerC, 'Calendar C'); // wont opt in
        $d = $this->makeVerein($ownerD, 'Calendar D'); // diff muni

        $svc->setConsent($a, 'both', '8001');
        $svc->setConsent($b, 'events', '8001');
        $svc->setConsent($c, 'none', '8001');
        $svc->setConsent($d, 'both', '8002');

        $eventA = $this->makeEvent($ownerA, 'Event from A');
        $eventB = $this->makeEvent($ownerB, 'Event from B');
        $eventC = $this->makeEvent($ownerC, 'Event from C');
        $eventD = $this->makeEvent($ownerD, 'Event from D');

        $cal = $svc->getMunicipalityCalendar(self::TENANT_ID, '8001', 'month');
        $this->assertSame('8001', $cal['municipality_code']);

        $allTitles = [];
        foreach ($cal['buckets'] as $bucket) {
            foreach ($bucket as $ev) {
                $allTitles[] = $ev['title'];
            }
        }

        $this->assertContains('Event from A', $allTitles);
        $this->assertContains('Event from B', $allTitles);
        $this->assertNotContains('Event from C', $allTitles);
        $this->assertNotContains('Event from D', $allTitles);
    }

    public function test_default_public_calendar_uses_first_consenting_municipality(): void
    {
        $svc = app(VereinFederationService::class);

        $ownerA = $this->makeUser();
        $ownerB = $this->makeUser();
        $a = $this->makeVerein($ownerA, 'Default Calendar A');
        $b = $this->makeVerein($ownerB, 'Default Calendar B');

        $svc->setConsent($a, 'both', '8001');
        $svc->setConsent($b, 'both', '8002');

        $this->makeEvent($ownerA, 'Default event from A');
        $this->makeEvent($ownerB, 'Default event from B');

        $response = $this->apiGet('/v2/municipality/events-calendar');

        $response->assertStatus(200);
        $response->assertJsonPath('data.municipality_code', '8001');

        $allTitles = [];
        foreach ($response->json('data.buckets') as $bucket) {
            foreach ($bucket as $event) {
                $allTitles[] = $event['title'];
            }
        }

        $this->assertContains('Default event from A', $allTitles);
        $this->assertNotContains('Default event from B', $allTitles);
    }

    public function test_default_public_calendar_returns_empty_payload_without_consents(): void
    {
        $response = $this->apiGet('/v2/municipality/events-calendar');

        $response->assertStatus(200);
        $response->assertJsonPath('data.municipality_code', null);
        $response->assertJsonPath('data.buckets', []);
    }

    public function test_public_calendar_excludes_events_in_private_groups(): void
    {
        $service = app(VereinFederationService::class);
        $ownerId = $this->makeUser();
        $organizationId = $this->makeVerein($ownerId, 'Private Calendar Club');
        $service->setConsent($organizationId, 'events', '8001');

        $publicGroupId = $this->makeGroup($ownerId, 'public');
        $privateGroupId = $this->makeGroup($ownerId, 'private');
        $secretGroupId = $this->makeGroup($ownerId, 'secret');
        $inactiveGroupId = $this->makeGroup($ownerId, 'public', GroupStatus::Archived);
        $otherTenantId = (int) DB::table('tenants')->where('id', '<>', self::TENANT_ID)->value('id');
        $this->assertGreaterThan(0, $otherTenantId, 'A second tenant is required for the isolation control.');
        $crossTenantGroupId = $this->makeGroup($ownerId, 'public', GroupStatus::Active, $otherTenantId);
        $this->makeEvent($ownerId, 'Public municipality event');
        $this->makeEvent($ownerId, 'Public group municipality event', $publicGroupId);
        $this->makeEvent($ownerId, 'Private group municipality event', $privateGroupId);
        $this->makeEvent($ownerId, 'Secret group municipality event', $secretGroupId);
        $this->makeEvent($ownerId, 'Inactive group municipality event', $inactiveGroupId);
        $this->makeEvent($ownerId, 'Cross-tenant group municipality event', $crossTenantGroupId);

        $response = $this->apiGet('/v2/municipality/8001/events-calendar');

        $response->assertOk();
        $titles = collect($response->json('data.buckets'))
            ->flatten(1)
            ->pluck('title')
            ->all();

        $this->assertContains('Public municipality event', $titles);
        $this->assertContains('Public group municipality event', $titles);
        $this->assertNotContains('Private group municipality event', $titles);
        $this->assertNotContains('Secret group municipality event', $titles);
        $this->assertNotContains('Inactive group municipality event', $titles);
        $this->assertNotContains('Cross-tenant group municipality event', $titles);
    }
}
