<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Services\ShiftSwapService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Found walking the swap journey (7 Oct 2026): NotificationDispatcher treats the same
 * type + link within 60 seconds as a duplicate (deliberately — a burst of chat
 * messages makes one bell). Every swap notification pointed at one shared link, so
 * the admin's "approved" arriving within a minute of the recipient's "accepted"
 * (same type) was silently dropped, and so was a second swap request to the same
 * person. Each swap — and the admin step — now has its own link.
 */
class ShiftSwapNotificationsTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId;
    private int $ownerId;
    private int $opportunityId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenantId = $this->testTenantId;
        DB::table('tenants')->where('id', $this->tenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->tenantId);
        Cache::flush();

        $this->ownerId = $this->user('Swap notice owner');
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->tenantId, 'user_id' => $this->ownerId, 'name' => 'Swap notice organisation',
            'slug' => 'swap-notice-' . bin2hex(random_bytes(6)), 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->tenantId, 'organization_id' => $orgId, 'created_by' => $this->ownerId,
            'title' => 'Swap notice opportunity', 'description' => 'Fixture', 'status' => 'active', 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function user(string $name): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId, 'name' => $name,
            'email' => strtolower(str_replace(' ', '-', $name)) . '-' . bin2hex(random_bytes(8)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0, 'role' => 'member', 'status' => 'active', 'is_active' => true,
            'is_approved' => true, 'preferred_language' => 'en', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function bookedShift(int $userId, int $daysAhead): int
    {
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->tenantId, 'opportunity_id' => $this->opportunityId,
            'start_time' => now()->addDays($daysAhead), 'end_time' => now()->addDays($daysAhead)->addHours(2), 'capacity' => 5,
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->tenantId, 'opportunity_id' => $this->opportunityId, 'shift_id' => $shiftId,
            'user_id' => $userId, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $shiftId;
    }

    private function swapRequest(int $from, int $to, int $fromShift, int $toShift, bool $requiresAdmin): int
    {
        return (int) DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $this->tenantId, 'from_user_id' => $from, 'to_user_id' => $to,
            'from_shift_id' => $fromShift, 'to_shift_id' => $toShift,
            'status' => 'pending', 'requires_admin_approval' => $requiresAdmin ? 1 : 0, 'created_at' => now(),
        ]);
    }

    /** @return list<string> */
    private function bellTypes(int $userId): array
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->tenantId)
            ->where('user_id', $userId)
            ->orderBy('id')
            ->pluck('type')
            ->all();
    }

    public function test_the_requester_is_told_both_accepted_and_approved_within_the_same_minute(): void
    {
        $requester = $this->user('Swap notice requester');
        $recipient = $this->user('Swap notice recipient');
        $swapId = $this->swapRequest($requester, $recipient, $this->bookedShift($requester, 2), $this->bookedShift($recipient, 3), true);

        $this->assertTrue(ShiftSwapService::respond($swapId, $recipient, 'accept'), json_encode(ShiftSwapService::getErrors()));
        $this->assertSame('admin_pending', DB::table('vol_shift_swap_requests')->where('id', $swapId)->value('status'));
        $this->assertTrue(ShiftSwapService::adminDecision($swapId, $this->ownerId, 'approve'), json_encode(ShiftSwapService::getErrors()));

        $this->assertSame(['vol_swap_approved', 'vol_swap_approved'], $this->bellTypes($requester),
            'both the recipient\'s acceptance and the admin\'s approval reach the requester');
        $links = DB::table('notifications')->where('user_id', $requester)->orderBy('id')->pluck('link')->all();
        foreach ($links as $link) {
            $this->assertStringStartsWith('/volunteering?tab=swaps', (string) $link, 'every client still opens the swaps tab');
        }
    }

    public function test_two_swap_requests_to_the_same_person_within_a_minute_both_arrive(): void
    {
        $recipient = $this->user('Swap notice popular');
        $recipientShift = $this->bookedShift($recipient, 4);
        $first = $this->user('Swap notice first asker');
        $second = $this->user('Swap notice second asker');

        $this->assertNotNull(ShiftSwapService::requestSwap($first, [
            'from_shift_id' => $this->bookedShift($first, 5), 'to_shift_id' => $recipientShift,
        ]), json_encode(ShiftSwapService::getErrors()));
        $this->assertNotNull(ShiftSwapService::requestSwap($second, [
            'from_shift_id' => $this->bookedShift($second, 6), 'to_shift_id' => $recipientShift,
        ]), json_encode(ShiftSwapService::getErrors()));

        $this->assertSame(['vol_swap_requested', 'vol_swap_requested'], $this->bellTypes($recipient));
    }
}
