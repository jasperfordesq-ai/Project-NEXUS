<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-482 (E-075) — eight administrator write routes reported success for an
 * object belonging to another community, and one of them wrote the non-event
 * to the administrative audit log.
 *
 * In every case the SQL or the service was already correctly filtered on
 * `tenant_id`, which is why the victim row was never touched. The controller
 * discarded the affected-row count or the boolean it was handed and answered
 * with an ordinary success payload. The in-house counter-example is in one of
 * the same files: `AdminNewsletterController::destroyTemplate()` checks its
 * delete count and answers 404.
 *
 * Correct behaviour, asserted here for each of the eight routes: an object of
 * another community is refused with 404 and nothing is written to the audit
 * log — **and** the owning community's administrator's identical call still
 * really changes the row.
 *
 * Adapted from
 * `.local-docs-archive/security-log/E-075/repro/f/F4ForeignAdminFalseSuccessConfirmationTest.php`
 * (four routes, asserting the bad outcome) and the F3 sweep's row snapshots
 * (`repro/f/results-f3-adminwrites.json`) for the other four.
 */
final class F482AdminWritesReportWhatTheyChangedTest extends TestCase
{
    use DatabaseTransactions;

    private const HOME = 2;     // victim community
    private const OTHER = 999;  // caller's own community

    private function admin(int $tenant): User
    {
        return User::factory()->forTenant($tenant)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
    }

    private function actAs(User $u, int $tenant): void
    {
        Sanctum::actingAs($u, ['*']);
        $this->withTenant($tenant);
        \App\Core\TenantContext::reset();
        \App\Core\TenantContext::setById($tenant);
    }

    /** @return array<string, string> */
    private function headers(int $tenant): array
    {
        return ['X-Tenant-ID' => (string) $tenant, 'Accept' => 'application/json'];
    }

    /** Turn every module on for a community so the feature gates do not mask the check. */
    private function enableAllFeatures(int $tenantId): void
    {
        if (! DB::table('tenants')->where('id', $tenantId)->exists()) {
            return;
        }
        if (in_array('features', Schema::getColumnListing('tenants'), true)) {
            $all = [];
            foreach (array_keys(\App\Services\TenantFeatureConfig::FEATURE_DEFAULTS) as $k) {
                $all[$k] = true;
            }
            DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($all)]);
        }
        \App\Core\TenantContext::reset();
        \App\Core\TenantContext::setById($tenantId);
    }

    private function assertRefused(TestResponse $r, string $what): void
    {
        $r->assertStatus(404);
        self::assertSame(
            'NOT_FOUND',
            $r->json('errors.0.code'),
            $what . ': an object of another community must be refused, not reported as changed'
        );
    }

    // ------------------------------------------------------------------ 1/8
    //  PUT /v2/admin/newsletters/templates/{id}

    public function test_newsletter_template_update_refuses_a_foreign_template_and_the_owner_still_renames_it(): void
    {
        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('newsletter_templates')->insertGetId([
            'tenant_id' => self::HOME,
            'name' => 'E076E victim template',
            'subject' => 'victim subject',
            'content' => 'victim content',
            'content_format' => 'richtext',
            'created_by' => $owner->id,
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->putJson("/api/v2/admin/newsletters/templates/{$id}", [
            'name' => 'TAKEN OVER BY E076E',
        ], $this->headers(self::OTHER));

        $this->assertRefused($attack, 'newsletter template update');
        self::assertSame(
            'E076E victim template',
            DB::table('newsletter_templates')->where('id', $id)->value('name'),
            'the victim template keeps its name'
        );

        // It now agrees with its delete sibling in the same controller.
        $del = $this->deleteJson("/api/v2/admin/newsletters/templates/{$id}", [], $this->headers(self::OTHER));
        $del->assertStatus(404);

        // CONTROL — the owning administrator's identical call really renames it.
        $this->actAs($owner, self::HOME);
        $control = $this->putJson("/api/v2/admin/newsletters/templates/{$id}", [
            'name' => 'RENAMED BY THE OWNER',
        ], $this->headers(self::HOME));
        $control->assertJsonPath('data.updated', true);
        self::assertSame(
            'RENAMED BY THE OWNER',
            DB::table('newsletter_templates')->where('id', $id)->value('name'),
            'control: the owner really does rename it'
        );
    }

    // ------------------------------------------------------------------ 2/8
    //  DELETE /v2/admin/enterprise/roles/{id}

    public function test_enterprise_role_delete_refuses_a_foreign_role_and_the_owner_still_deletes_it(): void
    {
        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('roles')->insertGetId([
            'tenant_id' => self::HOME,
            'name' => 'e076e_victim_role',
            'display_name' => 'E076E victim role',
            'level' => 1,
            'is_system' => 0,
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->deleteJson("/api/v2/admin/enterprise/roles/{$id}", [], $this->headers(self::OTHER));
        $this->assertRefused($attack, 'enterprise role delete');
        self::assertSame(1, DB::table('roles')->where('id', $id)->count(), 'the victim role survives');

        // CONTROL
        $this->actAs($owner, self::HOME);
        $control = $this->deleteJson("/api/v2/admin/enterprise/roles/{$id}", [], $this->headers(self::HOME));
        $control->assertJsonPath('data.deleted', true);
        self::assertSame(0, DB::table('roles')->where('id', $id)->count(), 'control: the owner really deletes it');
    }

    // ------------------------------------------------------------------ 3/8
    //  PUT /v2/admin/group-collections/{id}/groups — the audit-log case

    public function test_group_collection_set_groups_refuses_a_foreign_collection_and_writes_no_audit_row(): void
    {
        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $collectionId = (int) DB::table('group_collections')->insertGetId([
            'tenant_id' => self::HOME,
            'name' => 'E076E victim collection',
            'sort_order' => 0,
            'is_active' => 1,
            'created_by' => $owner->id,
        ]);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => self::HOME,
            'owner_id' => $owner->id,
            'name' => 'E076E victim group',
            'slug' => 'e076e-victim-group',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
        ]);
        DB::table('group_collection_items')->insert([
            'collection_id' => $collectionId,
            'group_id' => $groupId,
            'sort_order' => 0,
        ]);

        $logBefore = DB::table('activity_log')
            ->where('action', 'admin_set_group_collection_groups')
            ->where('tenant_id', self::OTHER)
            ->count();

        $this->actAs($stranger, self::OTHER);
        $attack = $this->putJson("/api/v2/admin/group-collections/{$collectionId}/groups", [
            'group_ids' => [],
        ], $this->headers(self::OTHER));

        $this->assertRefused($attack, 'group collection set-groups');
        self::assertSame(
            1,
            DB::table('group_collection_items')->where('collection_id', $collectionId)->count(),
            'the victim collection still holds its group'
        );
        self::assertSame(
            $logBefore,
            DB::table('activity_log')
                ->where('action', 'admin_set_group_collection_groups')
                ->where('tenant_id', self::OTHER)
                ->count(),
            'the administrative audit log must not record an action that did not happen'
        );

        // CONTROL — the owning administrator's identical call really empties it
        // and does write its audit row.
        $this->actAs($owner, self::HOME);
        $ownerLogBefore = DB::table('activity_log')
            ->where('action', 'admin_set_group_collection_groups')
            ->where('tenant_id', self::HOME)
            ->count();
        $control = $this->putJson("/api/v2/admin/group-collections/{$collectionId}/groups", [
            'group_ids' => [],
        ], $this->headers(self::HOME));
        $control->assertStatus(200);
        self::assertSame(
            0,
            DB::table('group_collection_items')->where('collection_id', $collectionId)->count(),
            'control: the owner really does empty it'
        );
        self::assertSame(
            $ownerLogBefore + 1,
            DB::table('activity_log')
                ->where('action', 'admin_set_group_collection_groups')
                ->where('tenant_id', self::HOME)
                ->count(),
            'control: the real action is still audited'
        );
    }

    // ------------------------------------------------------------------ 4/8
    //  DELETE /v2/admin/caring-community/federation-peers/{id}

    public function test_federation_peer_delete_refuses_a_foreign_peer_and_the_owner_still_deletes_it(): void
    {
        $this->enableAllFeatures(self::HOME);
        $this->enableAllFeatures(self::OTHER);

        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('caring_federation_peers')->insertGetId([
            'tenant_id' => self::HOME,
            'peer_slug' => 'e076e-victim-peer',
            'display_name' => 'E076E victim peer',
            'base_url' => 'https://victim.invalid',
            'shared_secret' => str_repeat('a', 64),
            'status' => 'active',
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->deleteJson("/api/v2/admin/caring-community/federation-peers/{$id}", [], $this->headers(self::OTHER));
        // This controller's own not-found code, as its rotate-secret sibling uses.
        $attack->assertStatus(404);
        self::assertSame('PEER_NOT_FOUND', $attack->json('errors.0.code'));
        self::assertSame(1, DB::table('caring_federation_peers')->where('id', $id)->count(), 'the victim peer survives');

        // CONTROL
        $this->actAs($owner, self::HOME);
        $control = $this->deleteJson("/api/v2/admin/caring-community/federation-peers/{$id}", [], $this->headers(self::HOME));
        $control->assertJsonPath('data.deleted', true);
        self::assertSame(0, DB::table('caring_federation_peers')->where('id', $id)->count(), 'control: the owner really deletes it');
    }

    // ------------------------------------------------------------------ 5/8
    //  DELETE /v2/admin/courses/categories/{id}

    public function test_course_category_delete_refuses_a_foreign_category_and_the_owner_still_deletes_it(): void
    {
        $this->enableAllFeatures(self::HOME);
        $this->enableAllFeatures(self::OTHER);

        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('course_categories')->insertGetId([
            'tenant_id' => self::HOME,
            'name' => 'E076E victim course category',
            'slug' => 'e076e-victim-course-category',
            'position' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->deleteJson("/api/v2/admin/courses/categories/{$id}", [], $this->headers(self::OTHER));
        $attack->assertStatus(404);
        self::assertSame(1, DB::table('course_categories')->where('id', $id)->count(), 'the victim category survives');

        // CONTROL
        $this->actAs($owner, self::HOME);
        $control = $this->deleteJson("/api/v2/admin/courses/categories/{$id}", [], $this->headers(self::HOME));
        $control->assertJsonPath('data.deleted', true);
        self::assertSame(0, DB::table('course_categories')->where('id', $id)->count(), 'control: the owner really deletes it');
    }

    // ------------------------------------------------------------------ 6/8
    //  DELETE /v2/skills/categories/{id}

    public function test_skill_category_delete_refuses_a_foreign_category_and_the_owner_still_deactivates_it(): void
    {
        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('skill_categories')->insertGetId([
            'tenant_id' => self::HOME,
            'name' => 'E076E victim skill category',
            'slug' => 'e076e-victim-skill-category',
            'display_order' => 0,
            'is_active' => 1,
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->deleteJson("/api/v2/skills/categories/{$id}", [], $this->headers(self::OTHER));
        $this->assertRefused($attack, 'skill category delete');
        self::assertSame(
            1,
            (int) DB::table('skill_categories')->where('id', $id)->value('is_active'),
            'the victim category is still active'
        );

        // CONTROL — the owning administrator's identical call really deactivates it.
        $this->actAs($owner, self::HOME);
        $control = $this->deleteJson("/api/v2/skills/categories/{$id}", [], $this->headers(self::HOME));
        $control->assertStatus(200);
        self::assertSame(
            0,
            (int) DB::table('skill_categories')->where('id', $id)->value('is_active'),
            'control: the owner really does deactivate it'
        );
    }

    // ------------------------------------------------------------------ 7/8
    //  DELETE /v2/admin/caring-community/emergency-alerts/{id}

    public function test_emergency_alert_deactivate_refuses_a_foreign_alert_and_the_owner_still_deactivates_it(): void
    {
        $this->enableAllFeatures(self::HOME);
        $this->enableAllFeatures(self::OTHER);

        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('caring_emergency_alerts')->insertGetId([
            'tenant_id' => self::HOME,
            'title' => 'E076E victim alert',
            'body' => 'E076E victim alert body',
            'severity' => 'warning',
            'is_active' => 1,
            'created_by' => $owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->deleteJson("/api/v2/admin/caring-community/emergency-alerts/{$id}", [], $this->headers(self::OTHER));
        $this->assertRefused($attack, 'emergency alert deactivate');
        self::assertSame(
            1,
            (int) DB::table('caring_emergency_alerts')->where('id', $id)->value('is_active'),
            'the victim alert is still active'
        );

        // CONTROL — the owning administrator's identical call really deactivates it.
        $this->actAs($owner, self::HOME);
        $control = $this->deleteJson("/api/v2/admin/caring-community/emergency-alerts/{$id}", [], $this->headers(self::HOME));
        $control->assertJsonPath('data.ok', true);
        self::assertSame(
            0,
            (int) DB::table('caring_emergency_alerts')->where('id', $id)->value('is_active'),
            'control: the owner really does deactivate it'
        );
    }

    // ------------------------------------------------------------------ 8/8
    //  POST /v2/admin/pilot-inquiries/{id}/notes

    public function test_pilot_inquiry_notes_refuses_a_foreign_inquiry_and_the_owner_still_saves_the_note(): void
    {
        $owner = $this->admin(self::HOME);
        $stranger = $this->admin(self::OTHER);

        $id = (int) DB::table('pilot_inquiries')->insertGetId([
            'tenant_id' => self::HOME,
            'municipality_name' => 'E076E victim municipality',
            'country' => 'IE',
            'contact_name' => 'E076E victim contact',
            'contact_email' => 'e076e-victim@example.invalid',
            'stage' => 'new',
            'internal_notes' => 'original note',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actAs($stranger, self::OTHER);
        $attack = $this->postJson("/api/v2/admin/pilot-inquiries/{$id}/notes", [
            'internal_notes' => 'OVERWRITTEN BY E076E',
        ], $this->headers(self::OTHER));

        $this->assertRefused($attack, 'pilot inquiry notes');
        self::assertSame(
            'original note',
            DB::table('pilot_inquiries')->where('id', $id)->value('internal_notes'),
            'the victim inquiry keeps its note'
        );

        // CONTROL
        $this->actAs($owner, self::HOME);
        $control = $this->postJson("/api/v2/admin/pilot-inquiries/{$id}/notes", [
            'internal_notes' => 'NOTE BY THE OWNER',
        ], $this->headers(self::HOME));
        $control->assertJsonPath('data.success', true);
        self::assertSame(
            'NOTE BY THE OWNER',
            DB::table('pilot_inquiries')->where('id', $id)->value('internal_notes'),
            'control: the owner really does save the note'
        );
    }
}
