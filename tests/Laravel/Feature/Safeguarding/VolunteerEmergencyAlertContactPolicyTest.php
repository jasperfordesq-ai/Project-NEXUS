<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class VolunteerEmergencyAlertContactPolicyTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{owner: User, volunteer: User, shift_id: int} */
    private function fixture(): array
    {
        $this->enableVolunteeringFeature();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'skills' => 'driving, first aid',
        ]);
        TenantContext::setById($this->testTenantId);

        $organizationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Emergency Alert Test Organisation',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'title' => 'Emergency Alert Test Opportunity',
            'description' => 'Contact-policy regression fixture.',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $owner->id,
            'created_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHours(2),
            'capacity' => 2,
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => null,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ['owner' => $owner, 'volunteer' => $volunteer, 'shift_id' => $shiftId];
    }

    public function test_broadcast_denial_writes_no_alert_recipient_or_message(): void
    {
        ['owner' => $owner, 'volunteer' => $volunteer, 'shift_id' => $shiftId] = $this->fixture();
        Sanctum::actingAs($owner, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceBroadcastAllowed')
            ->once()
            ->with($owner->id, [$volunteer->id], [], $this->testTenantId, 'volunteer_emergency_alert_broadcast')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost('/v2/volunteering/emergency-alerts', [
            'shift_id' => $shiftId,
            'message' => 'Please contact me urgently about this shift.',
            'priority' => 'critical',
            'required_skills' => ['driving'],
        ]);

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('vol_emergency_alerts', [
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'created_by' => $owner->id,
        ]);
        $this->assertSame(0, DB::table('vol_emergency_alert_recipients')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $volunteer->id)
            ->count());
    }

    public function test_acceptance_denial_leaves_alert_and_recipient_pending(): void
    {
        ['owner' => $owner, 'volunteer' => $volunteer, 'shift_id' => $shiftId] = $this->fixture();
        $alertId = $this->createAlertRecipient($owner, $volunteer, $shiftId);
        Sanctum::actingAs($volunteer, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($volunteer->id, $owner->id, $this->testTenantId, 'volunteer_emergency_alert_acceptance')
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_POLICY_UNAVAILABLE', 'Policy unavailable'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPut("/v2/volunteering/emergency-alerts/{$alertId}", [
            'response' => 'accepted',
        ]);

        $response->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseHas('vol_emergency_alerts', ['id' => $alertId, 'status' => 'active']);
        $this->assertDatabaseHas('vol_emergency_alert_recipients', [
            'alert_id' => $alertId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'response' => 'pending',
        ]);
    }

    public function test_decline_remains_available_without_policy_check(): void
    {
        ['owner' => $owner, 'volunteer' => $volunteer, 'shift_id' => $shiftId] = $this->fixture();
        $alertId = $this->createAlertRecipient($owner, $volunteer, $shiftId);
        Sanctum::actingAs($volunteer, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->apiPut("/v2/volunteering/emergency-alerts/{$alertId}", [
            'response' => 'declined',
        ])->assertOk();

        $this->assertDatabaseHas('vol_emergency_alerts', ['id' => $alertId, 'status' => 'active']);
        $this->assertDatabaseHas('vol_emergency_alert_recipients', [
            'alert_id' => $alertId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'response' => 'declined',
        ]);
    }

    private function createAlertRecipient(User $owner, User $volunteer, int $shiftId): int
    {
        $alertId = (int) DB::table('vol_emergency_alerts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'created_by' => $owner->id,
            'priority' => 'urgent',
            'message' => 'Urgent shift help requested.',
            'status' => 'active',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
        DB::table('vol_emergency_alert_recipients')->insert([
            'alert_id' => $alertId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'notified_at' => now(),
            'response' => 'pending',
        ]);

        return $alertId;
    }

    private function enableVolunteeringFeature(): void
    {
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true);
        $features = is_array($features) ? $features : [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }
}
