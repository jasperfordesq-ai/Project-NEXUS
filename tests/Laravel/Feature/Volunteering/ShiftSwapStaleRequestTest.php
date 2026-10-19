<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ShiftSwapService;
use App\Services\VolunteerService;
use App\Support\Push\PushCopy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A swap request that can no longer complete must say so, on every client, instead
 * of sitting "Pending" with a working Accept button.
 *
 * 🔴 Found walking the swaps journey on 19 Oct 2026. A request names two volunteers
 * and the shifts they hold at the moment of asking. Nothing retired it when that
 * stopped being true: the requester cancelling their shift, moving to another shift,
 * being taken off the roster, the shift starting, or a different swap moving one of
 * them. The recipient kept a live Accept button; pressing it either failed with a
 * generic "Failed to accept swap request" or — with admin approval switched on — went
 * into the admin queue as `admin_pending`, where Approve then failed too. The admin
 * sidebar badge counted those dead requests.
 *
 * `ShiftSwapService::expireStaleRequests()` is the one rule: an open request whose
 * shifts have started, or whose volunteers no longer hold the shifts it names, becomes
 * `expired`. It runs before every list and every decision, and from every place a
 * volunteer leaves a shift.
 */
class ShiftSwapStaleRequestTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        // Default tenant state: no admin step unless a test switches it on.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'volunteering.swap_requires_admin')
            ->delete();
    }

    /** @return array{0:int,1:array<int,int>} opportunity id and three future shift ids */
    private function makeOpportunityWithShifts(int $count = 3): array
    {
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => null,
            'title' => 'Stale swap fixture',
            'description' => 'Shifts for the stale-request tests.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $shifts = [];
        for ($i = 0; $i < $count; $i++) {
            $shifts[] = DB::table('vol_shifts')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'opportunity_id' => $opportunityId,
                'start_time' => now()->addDays(7 + $i * 2),
                'end_time' => now()->addDays(7 + $i * 2)->addHours(2),
                'capacity' => 2,
                'created_at' => now(),
            ]);
        }

        return [$opportunityId, $shifts];
    }

    private function volunteerOn(int $opportunityId, int $shiftId): int
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => $shiftId,
            'user_id' => $user->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) $user->id;
    }

    private function request(int $fromUser, int $fromShift, int $toShift): int
    {
        $id = ShiftSwapService::requestSwap($fromUser, ['from_shift_id' => $fromShift, 'to_shift_id' => $toShift]);
        $this->assertNotNull($id, 'fixture swap request should be created: ' . json_encode(ShiftSwapService::getErrors()));

        return (int) $id;
    }

    private function swapStatus(int $swapId): string
    {
        return (string) DB::table('vol_shift_swap_requests')->where('id', $swapId)->value('status');
    }

    private function switchOnAdminApproval(): void
    {
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'volunteering.swap_requires_admin',
            'setting_value' => 'true',
            'setting_type' => 'boolean',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_request_expires_when_the_requester_gives_up_their_shift(): void
    {
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        $this->assertTrue(VolunteerService::cancelShiftSignup($shiftA, $asker), json_encode(VolunteerService::getErrors()));

        $this->assertSame('expired', $this->swapStatus($swapId), 'cancelling the shift must retire the request at once');

        // The recipient's list says so, and Accept is refused with a reason, not a 500.
        $received = ShiftSwapService::getSwapRequests($holder, 'received');
        $this->assertCount(1, $received);
        $this->assertSame('expired', $received[0]['status']);

        $this->assertFalse(ShiftSwapService::respond($swapId, $holder, 'accept'));
        $this->assertSame('DECISION_CONFLICT', ShiftSwapService::getErrors()[0]['code']);
        $this->assertSame('expired', $this->swapStatus($swapId));
    }

    public function test_a_request_expires_when_the_recipient_is_no_longer_on_the_shift(): void
    {
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        // The holder moves off shift B by other means (roster removal, group release,
        // another swap…): the application row simply no longer names the shift.
        DB::table('vol_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $holder)
            ->update(['shift_id' => null]);

        // Nothing wrote to the swap table, so the next READ has to do it.
        $sent = ShiftSwapService::getSwapRequests($asker, 'sent');
        $this->assertSame('expired', $sent[0]['status']);
        $this->assertSame('expired', $this->swapStatus($swapId));
    }

    public function test_a_request_expires_once_either_shift_has_started(): void
    {
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        DB::table('vol_shifts')->where('id', $shiftB)->update([
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);

        $received = ShiftSwapService::getSwapRequests($holder, 'received');
        $this->assertSame('expired', $received[0]['status']);
        $this->assertFalse(ShiftSwapService::respond($swapId, $holder, 'accept'));
    }

    public function test_a_completed_swap_retires_other_requests_on_the_same_places(): void
    {
        [$opportunityId, [$shiftA, $shiftB, $shiftC]] = $this->makeOpportunityWithShifts(3);
        $alice = $this->volunteerOn($opportunityId, $shiftA);
        $bob = $this->volunteerOn($opportunityId, $shiftB);
        $cara = $this->volunteerOn($opportunityId, $shiftC);

        // Cara asks Alice for shift A; Alice asks Bob for shift B.
        $caraAsksAlice = $this->request($cara, $shiftC, $shiftA);
        $aliceAsksBob = $this->request($alice, $shiftA, $shiftB);

        // Bob agrees: Alice is now on B, Bob on A. Cara's request named Alice on A.
        $this->assertTrue(ShiftSwapService::respond($aliceAsksBob, $bob, 'accept'), json_encode(ShiftSwapService::getErrors()));
        $this->assertSame('accepted', $this->swapStatus($aliceAsksBob));

        $this->assertSame('expired', $this->swapStatus($caraAsksAlice), 'a swap must retire requests that named a volunteer on a shift they just left');
        // Alice no longer sees an Accept she cannot honour.
        $aliceReceived = ShiftSwapService::getSwapRequests($alice, 'received');
        $this->assertSame('expired', $aliceReceived[0]['status']);
    }

    public function test_admin_queue_drops_a_request_that_can_no_longer_complete(): void
    {
        $this->switchOnAdminApproval();
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        $this->assertTrue(ShiftSwapService::respond($swapId, $holder, 'accept'), json_encode(ShiftSwapService::getErrors()));
        $this->assertSame('admin_pending', $this->swapStatus($swapId));
        $this->assertCount(1, array_filter(ShiftSwapService::getAdminPendingSwaps(), fn (array $r) => $r['id'] === $swapId));

        // The asker gives the shift up while the admin is still deciding.
        $this->assertTrue(VolunteerService::cancelShiftSignup($shiftA, $asker), json_encode(VolunteerService::getErrors()));

        $this->assertSame('expired', $this->swapStatus($swapId));
        $this->assertCount(0, array_filter(ShiftSwapService::getAdminPendingSwaps(), fn (array $r) => $r['id'] === $swapId));

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $this->assertFalse(ShiftSwapService::adminDecision($swapId, (int) $admin->id, 'approve'));
        $this->assertSame('DECISION_CONFLICT', ShiftSwapService::getErrors()[0]['code']);
    }

    public function test_accepting_into_the_admin_queue_checks_both_places_first(): void
    {
        $this->switchOnAdminApproval();
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        // The asker leaves by a path that writes nothing to the swap table.
        DB::table('vol_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $asker)
            ->update(['shift_id' => null]);

        // Before 19 Oct 2026 this returned true and parked a dead request in the admin queue.
        $this->assertFalse(ShiftSwapService::respond($swapId, $holder, 'accept'));
        $this->assertSame('expired', $this->swapStatus($swapId));
        $this->assertSame([], ShiftSwapService::getAdminPendingSwaps());
    }

    /**
     * Nobody was told when a request was retired: the asker kept waiting for an answer
     * that could never come (19 Oct 2026). One bell and one phone alert now go to the
     * asker, in their own language, naming the shift they asked for. The other volunteer
     * is not told — they were only ever asked, and the request simply leaves their list.
     */
    public function test_the_asker_is_told_in_their_own_language_when_their_request_expires(): void
    {
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        DB::table('users')->where('id', $asker)->update(['preferred_language' => 'de']);
        $swapId = $this->request($asker, $shiftA, $shiftB);
        $this->assertSame([], $this->bells($asker), 'asking creates no bell for the asker');

        DB::table('vol_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $holder)
            ->update(['shift_id' => null]);

        $this->assertSame(1, ShiftSwapService::expireStaleRequests($this->testTenantId));

        $bells = $this->bells($asker);
        $this->assertCount(1, $bells);
        $this->assertSame('vol_swap_expired', $bells[0]->type);
        $this->assertStringContainsString('ist nicht mehr möglich', $bells[0]->message, 'rendered in the asker\'s language, not the caller\'s');
        $this->assertStringNotContainsString('{{date}}', $bells[0]->message);
        // The shift they asked for (shift B), written the way German writes it.
        $toShiftStart = \Carbon\Carbon::parse((string) DB::table('vol_shifts')->where('id', $shiftB)->value('start_time'));
        $this->assertStringContainsString($toShiftStart->locale('de')->isoFormat('lll'), $bells[0]->message);
        $this->assertStringContainsString('swap=' . $swapId, (string) $bells[0]->link);

        // The holder keeps only the original "new swap request" bell: no expiry bell.
        $holderTypes = array_map(static fn ($bell) => $bell->type, $this->bells($holder));
        $this->assertSame(['vol_swap_requested'], $holderTypes, 'the volunteer who was asked is not told');

        // Running the sweep again finds nothing and sends nothing more.
        $this->assertSame(0, ShiftSwapService::expireStaleRequests($this->testTenantId));
        $this->assertCount(1, $this->bells($asker));
    }

    /** The phone's lock-screen copy for the new type names the shift and exists in every language. */
    public function test_the_expiry_push_names_the_shift_on_the_lock_screen(): void
    {
        $this->assertTrue(PushCopy::isCurated('vol_swap_expired'));
        $copy = PushCopy::render('vol_swap_expired', ['time' => '26 Oct 2026, 14:00']);
        $this->assertNotNull($copy);
        $this->assertStringContainsString('26 Oct 2026, 14:00', $copy['title']);
        $this->assertStringNotContainsString(':time', $copy['title']);
    }

    /** @return list<object{type: string, message: string, link: ?string}> */
    private function bells(int $userId): array
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->orderBy('id')
            ->get(['type', 'message', 'link'])
            ->all();
    }

    public function test_a_live_request_is_left_alone(): void
    {
        [$opportunityId, [$shiftA, $shiftB]] = $this->makeOpportunityWithShifts(2);
        $asker = $this->volunteerOn($opportunityId, $shiftA);
        $holder = $this->volunteerOn($opportunityId, $shiftB);
        $swapId = $this->request($asker, $shiftA, $shiftB);

        $this->assertSame(0, ShiftSwapService::expireStaleRequests($this->testTenantId));
        $this->assertSame('pending', $this->swapStatus($swapId));
        $this->assertSame('pending', ShiftSwapService::getSwapRequests($holder, 'received')[0]['status']);
    }
}
