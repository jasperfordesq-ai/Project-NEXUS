<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Verein;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\User;
use App\Services\CaringCommunity\VereinMemberImportService;
use App\Services\Verein\VereinFederationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class EventShareTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableCaring();
        TenantContext::setById(self::TENANT_ID);
    }

    private function enableCaring(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT_ID)->first();
        $features = is_array(json_decode((string) ($tenant->features ?? '[]'), true)) ? json_decode((string) $tenant->features, true) : [];
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT_ID)->update(['features' => json_encode($features)]);
    }

    private function seedVereinAdminRbac(): void
    {
        DB::statement("
            INSERT IGNORE INTO roles (name, display_name, description, level, is_system, tenant_id)
            VALUES ('verein_admin', 'Verein Admin', 'Scoped association administrator.', 4, 1, NULL)
        ");
        DB::statement("
            INSERT IGNORE INTO permissions (name, display_name, category)
            VALUES ('verein.members.manage', 'Manage Verein Members', 'vereine')
        ");

        $roleId = DB::table('roles')->where('name', 'verein_admin')->value('id');
        $permissionId = DB::table('permissions')->where('name', 'verein.members.manage')->value('id');
        DB::statement(
            'INSERT IGNORE INTO role_permissions (role_id, permission_id, tenant_id) VALUES (?, ?, NULL)',
            [$roleId, $permissionId],
        );
    }

    private function makeUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'first_name' => 'X',
            'last_name' => 'Y',
            'email' => 'u' . uniqid() . '@x.test',
            'username' => 'u_' . substr(md5(uniqid()), 0, 8),
            'password' => password_hash('x', PASSWORD_BCRYPT),
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeVerein(string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $this->makeUser(),
            'name' => $name,
            'slug' => strtolower($name) . '-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function makeEvent(int $userId, array $overrides = []): int
    {
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $userId,
            'title' => 'Test Event ' . uniqid(),
            'description' => 'desc',
            'start_time' => now()->addDays(7),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function makeGroup(int $ownerId, string $visibility): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'owner_id' => $ownerId,
            'name' => 'Event sharing ' . $visibility . ' group ' . uniqid(),
            'slug' => 'event-sharing-' . $visibility . '-' . uniqid(),
            'visibility' => $visibility,
            'status' => GroupStatus::Active->value,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_share_event_with_target_then_target_sees_it(): void
    {
        $svc = app(VereinFederationService::class);

        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Verein Source',
            'slug' => 'src-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Verein Target');

        $svc->setConsent($source, 'both', '8001');
        $svc->setConsent($target, 'events', '8001');

        $eventId = $this->makeEvent($sourceOwner);

        $result = $svc->shareEvent($eventId, [$target], $source, $sourceOwner);
        $this->assertSame(1, $result['shared']);
        $this->assertSame(0, $result['skipped']);

        $incoming = $svc->getSharedEvents($target, 'incoming');
        $this->assertCount(1, $incoming);
        $this->assertSame($eventId, $incoming[0]['event_id']);
    }

    public function test_withdraw_share_removes_from_target_view(): void
    {
        $svc = app(VereinFederationService::class);

        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Verein S2',
            'slug' => 's2-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Verein T2');

        $svc->setConsent($source, 'both', '8001');
        $svc->setConsent($target, 'both', '8001');

        $eventId = $this->makeEvent($sourceOwner);
        $svc->shareEvent($eventId, [$target], $source, $sourceOwner);

        $shares = $svc->getSharedEvents($source, 'outgoing');
        $this->assertCount(1, $shares);
        $shareId = $shares[0]['id'];

        $ok = $svc->withdrawEventShare($shareId, $source);
        $this->assertTrue($ok);

        $after = $svc->getSharedEvents($target, 'incoming');
        $this->assertCount(0, $after);
    }

    public function test_source_club_cannot_share_an_unrelated_event(): void
    {
        $service = app(VereinFederationService::class);
        $source = $this->makeVerein('Unrelated Event Source');
        $target = $this->makeVerein('Unrelated Event Target');
        $service->setConsent($source, 'events', '8001');
        $service->setConsent($target, 'events', '8001');

        $unrelatedEventId = $this->makeEvent($this->makeUser());
        $sourceOwner = (int) DB::table('vol_organizations')->where('id', $source)->value('user_id');

        try {
            $service->shareEvent($unrelatedEventId, [$target], $source, $sourceOwner);
            $this->fail('An event unrelated to the authorized source club must be rejected.');
        } catch (InvalidArgumentException) {
            $this->assertSame(
                0,
                DB::table('verein_event_shares')->where('event_id', $unrelatedEventId)->count(),
            );
        }
    }

    public function test_source_club_cannot_share_a_private_or_unpublished_event(): void
    {
        $service = app(VereinFederationService::class);
        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Restricted Event Source',
            'slug' => 'restricted-event-source-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Restricted Event Target');
        $service->setConsent($source, 'events', '8001');
        $service->setConsent($target, 'events', '8001');

        $privateGroupId = $this->makeGroup($sourceOwner, 'private');
        $privateEventId = $this->makeEvent($sourceOwner, ['group_id' => $privateGroupId]);
        $draftEventId = $this->makeEvent($sourceOwner, [
            'status' => 'draft',
            'publication_status' => 'draft',
        ]);

        foreach ([$privateEventId, $draftEventId] as $eventId) {
            try {
                $service->shareEvent($eventId, [$target], $source, $sourceOwner);
                $this->fail('A non-public event must be rejected.');
            } catch (InvalidArgumentException) {
                $this->assertSame(
                    0,
                    DB::table('verein_event_shares')->where('event_id', $eventId)->count(),
                );
            }
        }
    }

    public function test_shared_event_reads_hide_unrelated_legacy_rows(): void
    {
        $service = app(VereinFederationService::class);
        $source = $this->makeVerein('Legacy Row Source');
        $target = $this->makeVerein('Legacy Row Target');
        $service->setConsent($source, 'events', '8001');
        $service->setConsent($target, 'events', '8001');
        $eventId = $this->makeEvent($this->makeUser());

        DB::table('verein_event_shares')->insert([
            'tenant_id' => self::TENANT_ID,
            'source_organization_id' => $source,
            'target_organization_id' => $target,
            'event_id' => $eventId,
            'status' => 'active',
            'shared_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame([], $service->getSharedEvents($source, 'outgoing'));
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));
    }

    public function test_shared_event_reads_recheck_event_audience_and_current_consent(): void
    {
        $service = app(VereinFederationService::class);
        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Read Recheck Source',
            'slug' => 'read-recheck-source-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Read Recheck Target');
        $service->setConsent($source, 'events', '8001');
        $service->setConsent($target, 'events', '8001');
        $eventId = $this->makeEvent($sourceOwner);
        $service->shareEvent($eventId, [$target], $source, $sourceOwner);

        $this->assertCount(1, $service->getSharedEvents($target, 'incoming'));

        $privateGroupId = $this->makeGroup($sourceOwner, 'private');
        DB::table('events')->where('id', $eventId)->update(['group_id' => $privateGroupId]);
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));

        DB::table('events')->where('id', $eventId)->update([
            'group_id' => null,
            'status' => 'draft',
            'publication_status' => 'draft',
        ]);
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));

        DB::table('events')->where('id', $eventId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);
        $service->setConsent($target, 'none', '8001');
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));

        $service->setConsent($target, 'events', '8002');
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));

        $service->setConsent($target, 'events', '8001');
        $this->assertCount(1, $service->getSharedEvents($target, 'incoming'));

        $service->setConsent($source, 'none', '8001');
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));
    }

    public function test_scoped_club_admin_without_event_authority_cannot_share_the_owners_event(): void
    {
        $this->seedVereinAdminRbac();
        $service = app(VereinFederationService::class);
        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Actor Boundary Source',
            'slug' => 'actor-boundary-source-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Actor Boundary Target');
        $service->setConsent($source, 'events', '8001');
        $service->setConsent($target, 'events', '8001');
        $eventId = $this->makeEvent($sourceOwner);

        $scopedAdminId = $this->makeUser();
        $vereinAdmins = app(VereinMemberImportService::class);
        $vereinAdmins->assignVereinAdmin(self::TENANT_ID, $source, $scopedAdminId, $sourceOwner);
        Sanctum::actingAs(User::withoutGlobalScopes()->findOrFail($scopedAdminId));

        $denied = $this->apiPost("/v2/vereine/{$source}/share-event", [
            'event_id' => $eventId,
            'target_organization_ids' => [$target],
        ]);

        $denied->assertStatus(422);
        $denied->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $this->assertDatabaseMissing('verein_event_shares', [
            'tenant_id' => self::TENANT_ID,
            'source_organization_id' => $source,
            'event_id' => $eventId,
        ]);

        $vereinAdmins->assignVereinAdmin(self::TENANT_ID, $source, $sourceOwner, $sourceOwner);
        Sanctum::actingAs(User::withoutGlobalScopes()->findOrFail($sourceOwner));

        $allowed = $this->apiPost("/v2/vereine/{$source}/share-event", [
            'event_id' => $eventId,
            'target_organization_ids' => [$target],
        ]);

        $allowed->assertOk();
        $allowed->assertJsonPath('data.shared', 1);
    }

    public function test_clubs_without_municipality_codes_cannot_create_or_read_shares(): void
    {
        $service = app(VereinFederationService::class);
        $sourceOwner = $this->makeUser();
        $source = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $sourceOwner,
            'name' => 'Missing Municipality Source',
            'slug' => 'missing-municipality-source-' . uniqid(),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $target = $this->makeVerein('Missing Municipality Target');
        $service->setConsent($source, 'events', null);
        $service->setConsent($target, 'events', null);
        $eventId = $this->makeEvent($sourceOwner);

        $result = $service->shareEvent($eventId, [$target], $source, $sourceOwner);
        $this->assertSame(['shared' => 0, 'skipped' => 1], $result);

        DB::table('verein_event_shares')->insert([
            'tenant_id' => self::TENANT_ID,
            'source_organization_id' => $source,
            'target_organization_id' => $target,
            'event_id' => $eventId,
            'status' => 'active',
            'shared_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame([], $service->getSharedEvents($source, 'outgoing'));
        $this->assertSame([], $service->getSharedEvents($target, 'incoming'));
    }
}
