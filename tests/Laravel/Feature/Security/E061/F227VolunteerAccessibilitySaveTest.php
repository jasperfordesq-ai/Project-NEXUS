<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E061;

use App\Core\TenantContext;
use App\Models\User;
use App\Models\VolAccessibilityNeed;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-227 — saving volunteering accessibility needs must never report success
 * when nothing was saved, must never wipe a member's saved needs because of a
 * malformed request, and a member's needs must stay visible to that member only.
 *
 * Until E-061 the controller ignored the service's boolean result and always
 * answered `{success: true}`. Two needs of the same type (the React screen
 * defaults every new need to "other") hit the table's unique key, the
 * transaction rolled back, and the member was told it had been saved. A PUT
 * without a `needs` key replaced the member's whole set with nothing.
 */
class F227VolunteerAccessibilitySaveTest extends TestCase
{
    use DatabaseTransactions;

    private const URI = '/v2/volunteering/accessibility-needs';

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** Give the member one saved need, so a failed save can be shown not to lose it. */
    private function seedExistingNeed(User $user): void
    {
        DB::table('vol_accessibility_needs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'need_type' => 'mobility',
            'description' => 'Step-free access',
            'emergency_contact_name' => 'Pat',
            'emergency_contact_phone' => '+1 555 123 4567',
        ]);
    }

    private function savedTypes(User $user): array
    {
        return DB::table('vol_accessibility_needs')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->orderBy('need_type')
            ->pluck('need_type')
            ->all();
    }

    private function assertNotSuccess(\Illuminate\Testing\TestResponse $response, int $status): void
    {
        $response->assertStatus($status);
        $this->assertNotTrue($response->json('data.success'), 'A failed save must not answer success.');
        $this->assertNotEmpty($response->json('errors'), 'A failed save must carry an error.');
    }

    public function test_duplicate_need_types_are_refused_and_existing_needs_survive(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['needs' => [
            ['need_type' => 'other', 'description' => 'First'],
            ['need_type' => 'other', 'description' => 'Second'],
        ]]);

        $this->assertNotSuccess($response, 422);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_unknown_need_type_is_refused(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['needs' => [
            ['need_type' => 'telepathy'],
        ]]);

        $this->assertNotSuccess($response, 422);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_over_long_emergency_phone_is_refused(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['needs' => [
            ['need_type' => 'hearing', 'emergency_contact_phone' => str_repeat('1', 51)],
        ]]);

        $this->assertNotSuccess($response, 422);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_request_without_needs_key_does_not_wipe_saved_needs(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['need' => []]);

        $this->assertNotSuccess($response, 422);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_needs_that_is_not_a_list_is_refused(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['needs' => 'mobility']);

        $this->assertNotSuccess($response, 422);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_storage_failure_is_reported_as_an_error_and_rolls_back(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        // A write that fails below validation (database refusal, lost
        // connection) must surface as an error, not as `success: true`.
        VolAccessibilityNeed::creating(function (): void {
            throw new \RuntimeException('simulated storage failure');
        });

        $response = $this->apiPut(self::URI, ['needs' => [
            ['need_type' => 'visual', 'description' => 'Large print'],
        ]]);

        $this->assertNotSuccess($response, 500);
        $this->assertSame(['mobility'], $this->savedTypes($user));
    }

    public function test_valid_save_still_succeeds_and_an_empty_list_still_clears(): void
    {
        $this->enableVolunteering();
        $user = $this->member();
        $this->seedExistingNeed($user);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPut(self::URI, ['needs' => [
            ['need_type' => 'visual', 'description' => 'Large print', 'accommodations_required' => null],
            ['need_type' => 'dietary', 'emergency_contact_phone' => '+1 555 123 4567'],
        ]]);
        $response->assertStatus(200);
        $this->assertTrue($response->json('data.success'));
        $this->assertSame(['visual', 'dietary'], $this->savedTypes($user));

        // Deliberately removing every need is still allowed.
        $clear = $this->apiPut(self::URI, ['needs' => []]);
        $clear->assertStatus(200);
        $this->assertSame([], $this->savedTypes($user));
    }

    public function test_needs_are_readable_only_by_the_member_who_saved_them(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        $this->seedExistingNeed($owner);

        Sanctum::actingAs($owner, ['*']);
        $mine = $this->apiGet(self::URI);
        $mine->assertStatus(200);
        $this->assertSame(['mobility'], array_column($mine->json('data'), 'need_type'));

        // Another member of the same community — including an administrator —
        // reading the same endpoint gets their own (empty) list, never the owner's.
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
        Sanctum::actingAs($admin, ['*']);
        $theirs = $this->apiGet(self::URI . '?user_id=' . $owner->id);
        $theirs->assertStatus(200);
        $this->assertSame([], $theirs->json('data'));
    }
}
