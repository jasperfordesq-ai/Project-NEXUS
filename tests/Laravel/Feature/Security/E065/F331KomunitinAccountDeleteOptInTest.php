<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E065\Concerns\DrivesFederationPartnerApi;
use Tests\Laravel\TestCase;

/**
 * F-331 (E-065) — a federation partner could disable any member's sign-in.
 *
 * `DELETE /v2/federation/komunitin/{code}/accounts/{id}` set
 * `users.status = 'inactive'` for any active user in the community, selected by
 * `id` + `tenant_id` only. Members who deliberately stayed out of federation
 * could still be switched off, and ids are walkable, so a partner could have
 * disabled a whole community's sign-ins.
 *
 * 🔴 The scope gate `requireAdminScope()` is CORRECT and is not touched: it
 * denies on null permissions and requires `admin` or `*`. The defect was the
 * missing opt-in check, and only that is added.
 *
 * Adapted from the E-065 slice-A reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-a/KomunitinNestedOwnershipTest.php`
 * (`test_delete_account_deactivates_a_member_who_never_opted_in`), which PASSED
 * while the bug existed. The attack assertion is inverted.
 */
class F331KomunitinAccountDeleteOptInTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f331');
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    private function statusOf(int $userId): string
    {
        return (string) DB::table('users')->where('id', $userId)->value('status');
    }

    public function test_partner_cannot_deactivate_a_member_who_never_opted_in(): void
    {
        $code = $this->ownCurrencyCode();
        $optedOut = $this->makeMember(3.00);

        // This member is invisible on every federated read path.
        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedOut->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(404);

        $this->assertSame('active', $this->statusOf((int) $optedOut->id));

        $this->json(
            'DELETE',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedOut->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(404);

        $this->assertSame(
            'active',
            $this->statusOf((int) $optedOut->id),
            'A federation partner disabled the sign-in of a member who never opted into federation.'
        );
    }

    public function test_partner_can_still_deactivate_a_member_who_opted_in(): void
    {
        $code = $this->ownCurrencyCode();
        $optedIn = $this->makeMember(1.00);
        $this->optIn((int) $optedIn->id);

        $this->json(
            'DELETE',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedIn->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(204);

        $this->assertSame('inactive', $this->statusOf((int) $optedIn->id));
    }

    public function test_the_admin_scope_gate_is_unchanged(): void
    {
        // The pre-existing control: a key without admin/* scope is refused 403
        // before the opt-in check is ever reached. It must not be weakened by
        // the fix above.
        $this->tearDownFederationPartner();
        $this->bootFederationPartner(['transactions:read'], 'f331b');

        $code = $this->ownCurrencyCode();
        $optedIn = $this->makeMember(1.00);
        $this->optIn((int) $optedIn->id);

        $this->json(
            'DELETE',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedIn->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(403);

        $this->assertSame('active', $this->statusOf((int) $optedIn->id));
    }
}
