<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Services\MarketplaceDisputeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\Laravel\TestCase;

/**
 * F-341 (E-065 slice E) — a community administrator may not decide a
 * marketplace dispute on an order they are the buyer or the seller of.
 *
 * MarketplaceDisputeService::resolve() took the resolving administrator's id
 * purely as an audit value: it claimed the case with it and stamped
 * `resolved_by`, but never compared it with the order's `buyer_id` or
 * `seller_id`. The only gate was requireAdmin(), and nothing stops an
 * administrator from selling or buying on the marketplace. As the seller they
 * could close the buyer's dispute against themselves and release the disputed
 * escrow hold; as the buyer they could award themselves the refund.
 *
 * Same shape as F-237 for safeguarding cases, and the same remedy: separation
 * of duties, refused before the case is even claimed.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-e/MarketplaceDisputeSelfResolutionTest.php`,
 * which FAILS while the bug exists ("BAD OUTCOME:"). That polarity is kept; the
 * call is now wrapped so the refusal itself can be asserted.
 */
final class F341MarketplaceDisputeSelfResolutionTest extends TestCase
{
    use DatabaseTransactions;

    private function makeUser(string $role = 'member', bool $admin = false): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F341 dispute fixture',
            'email' => 'f341-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => $role,
            'is_admin' => $admin ? 1 : 0,
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array{0:int,1:int} order id, dispute id */
    private function makeDisputedOrder(int $buyerId, int $sellerId): array
    {
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sellerId,
            'title' => 'F341 dispute listing',
            'description' => 'F341 dispute listing',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $orderId = (int) DB::table('marketplace_orders')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'order_number' => 'F341-' . bin2hex(random_bytes(5)),
            'buyer_id' => $buyerId,
            'seller_id' => $sellerId,
            'marketplace_listing_id' => $listingId,
            'quantity' => 1,
            'unit_price' => 40.00,
            'total_price' => 40.00,
            'currency' => 'EUR',
            'status' => 'disputed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $disputeId = (int) DB::table('marketplace_disputes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'order_id' => $orderId,
            'opened_by' => $buyerId,
            'reason' => 'not_received',
            'description' => 'F341 fixture dispute',
            'status' => 'open',
            'prior_order_status' => 'paid',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$orderId, $disputeId];
    }

    private function orderStatus(int $orderId): string
    {
        return (string) DB::table('marketplace_orders')->where('id', $orderId)->value('status');
    }

    /** @return array{0:string,1:?int} dispute status, resolved_by */
    private function disputeState(int $disputeId): array
    {
        $row = DB::table('marketplace_disputes')->where('id', $disputeId)->first();

        return [(string) $row->status, $row->resolved_by === null ? null : (int) $row->resolved_by];
    }

    /* CONTROL — an uninvolved administrator resolves the dispute. Unchanged
     * behaviour: the separation-of-duties check must not disturb it. */
    public function test_control_uninvolved_admin_resolves_the_dispute(): void
    {
        TenantContext::setById($this->testTenantId);

        $buyerId = $this->makeUser();
        $sellerId = $this->makeUser();
        $adminId = $this->makeUser('admin', true);
        [, $disputeId] = $this->makeDisputedOrder($buyerId, $sellerId);

        $dispute = app(MarketplaceDisputeService::class)->resolve($disputeId, $adminId, [
            'resolution' => 'seller',
            'resolution_notes' => 'F341 control — decided by an uninvolved administrator',
        ]);

        self::assertSame('resolved_seller', (string) $dispute->status);
        self::assertSame($adminId, (int) $dispute->resolved_by);
        self::assertNotSame($sellerId, (int) $dispute->resolved_by, 'control: decider is not a party');
    }

    /* The administrator IS the seller in the disputed order. */
    public function test_admin_who_is_the_seller_cannot_decide_their_own_dispute(): void
    {
        TenantContext::setById($this->testTenantId);

        $buyerId = $this->makeUser();
        // The seller is also a community administrator.
        $sellerAdminId = $this->makeUser('admin', true);
        [$orderId, $disputeId] = $this->makeDisputedOrder($buyerId, $sellerAdminId);

        $refused = false;
        try {
            app(MarketplaceDisputeService::class)->resolve($disputeId, $sellerAdminId, [
                'resolution' => 'seller',
                'resolution_notes' => 'F341 — decided by the seller themselves',
            ]);
        } catch (InvalidArgumentException $exception) {
            $refused = true;
        }

        [$disputeStatus, $resolvedBy] = $this->disputeState($disputeId);
        $orderStatus = $this->orderStatus($orderId);

        self::assertFalse(
            $disputeStatus === 'resolved_seller'
                && $resolvedBy === $sellerAdminId
                && $orderStatus === 'paid',
            'BAD OUTCOME: dispute #' . $disputeId . ' on order #' . $orderId
            . ' was decided in the seller\'s favour BY THE SELLER (resolved_by='
            . var_export($resolvedBy, true) . ', seller_id=' . $sellerAdminId
            . '); order returned to status "' . $orderStatus . '".',
        );

        self::assertTrue($refused, 'the seller must be refused, not merely audited');
        self::assertSame('open', $disputeStatus, 'the dispute must be left untouched, not even claimed');
        self::assertNull($resolvedBy, 'resolved_by must not be stamped with a party to the order');
        self::assertSame('disputed', $orderStatus, 'the order must stay disputed');
    }

    /* The mirror case: the administrator is the BUYER and awards themselves
     * the refund decision. The fixture order carries no payment row, so the
     * zero-price branch would run — this asserts the authorization gap, not
     * the card money movement, which needs live Stripe credentials. */
    public function test_admin_who_is_the_buyer_cannot_decide_their_own_dispute(): void
    {
        TenantContext::setById($this->testTenantId);

        $buyerAdminId = $this->makeUser('admin', true);
        $sellerId = $this->makeUser();
        [$orderId, $disputeId] = $this->makeDisputedOrder($buyerAdminId, $sellerId);

        // total_price 0 so the no-payment branch would run instead of Stripe.
        DB::table('marketplace_orders')->where('id', $orderId)->update(['total_price' => 0, 'unit_price' => 0]);

        $refused = false;
        try {
            app(MarketplaceDisputeService::class)->resolve($disputeId, $buyerAdminId, [
                'resolution' => 'buyer',
                'resolution_notes' => 'F341 — decided by the buyer themselves',
            ]);
        } catch (InvalidArgumentException $exception) {
            $refused = true;
        }

        [$disputeStatus, $resolvedBy] = $this->disputeState($disputeId);
        $orderStatus = $this->orderStatus($orderId);

        self::assertFalse(
            $disputeStatus === 'resolved_buyer'
                && $resolvedBy === $buyerAdminId
                && $orderStatus === 'refunded',
            'BAD OUTCOME: dispute #' . $disputeId . ' on order #' . $orderId
            . ' was decided in the buyer\'s favour BY THE BUYER (resolved_by='
            . var_export($resolvedBy, true) . ', buyer_id=' . $buyerAdminId
            . '); order status is now "' . $orderStatus . '".',
        );

        self::assertTrue($refused, 'the buyer must be refused, not merely audited');
        self::assertSame('open', $disputeStatus, 'the dispute must be left untouched, not even claimed');
        self::assertNull($resolvedBy, 'resolved_by must not be stamped with a party to the order');
        self::assertSame('disputed', $orderStatus, 'the order must stay disputed');
    }
}
