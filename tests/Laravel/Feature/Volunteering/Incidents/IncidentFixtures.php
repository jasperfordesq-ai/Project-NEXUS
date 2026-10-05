<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Synthetic people, organisations and incidents for the incident case-record tests. */
trait IncidentFixtures
{
    protected function enableVolunteering(): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    protected function user(string $role = 'member', ?int $tenantId = null): User
    {
        $u = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role]);

        // The model is tenant-scoped to the current community; a fixture in another
        // community must still load.
        return User::withoutGlobalScopes()->findOrFail($u->id);
    }

    protected function organisation(User $owner, string $name, array $extra = []): int
    {
        return (int) DB::table('vol_organizations')->insertGetId(array_merge([
            'tenant_id' => $owner->tenant_id, 'user_id' => $owner->id, 'name' => $name,
            'status' => 'active', 'created_at' => now(),
        ], $extra));
    }

    protected function opportunity(int $orgId, string $title): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'title' => $title,
            'description' => $title . ' description', 'is_active' => 1, 'created_at' => now(),
        ]);
    }

    protected function orgMember(int $orgId, User $u, string $role, string $status = 'active'): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'org_type' => 'volunteer',
            'user_id' => $u->id, 'role' => $role, 'status' => $status, 'created_at' => now(),
        ]);
    }

    protected function incident(User $reporter, array $overrides = []): object
    {
        $id = (int) DB::table('vol_safeguarding_incidents')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'reported_by' => $reporter->id, 'title' => 'INCCASE fixture',
            'incident_type' => 'concern', 'category' => 'general', 'severity' => 'medium',
            'description' => 'A fixture incident description long enough.', 'status' => 'open',
            'incident_date' => now()->subDay()->toDateString(), 'created_at' => now(), 'updated_at' => now(),
        ], $overrides));

        return DB::table('vol_safeguarding_incidents')->where('id', $id)->first();
    }

    /** An open incident linked to a fresh organisation and opportunity. @return array{0: object, 1: int, 2: int} */
    protected function linkedIncident(?User $reporter = null): array
    {
        $orgId = $this->organisation($this->user(), 'INCCASE Org ' . uniqid());
        $oppId = $this->opportunity($orgId, 'INCCASE Opp ' . uniqid());
        $incident = $this->incident($reporter ?? $this->user(), ['organization_id' => $orgId, 'opportunity_id' => $oppId]);

        return [$incident, $orgId, $oppId];
    }
}
