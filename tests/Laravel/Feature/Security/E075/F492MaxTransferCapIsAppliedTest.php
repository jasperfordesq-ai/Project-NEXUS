<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PrerenderContentInvalidator;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-075 F-492 — the "Maximum transfer" field on the System Config page must
 * actually cap transfers.
 *
 * The defect: `AdminEnterpriseController::CONFIG_TENANT_SETTINGS` mapped the
 * field to `wallet.max_transaction`, a key nothing reads. The key the platform
 * enforces is `wallet.max_transfer` (`WalletService::maxTransferAmount()`,
 * applied in `transfer()`), which had no admin route that could write it —
 * `moduleRegistry.ts:158` carries `comingSoon: true`. So an administrator who
 * capped single transfers at 5 hours got no cap at all: the ceiling stayed at
 * the platform default of 1,000 hours, and a member moved 200 hours in one
 * transfer. Fourth dead key found in that map (after F-459), and the first on
 * money.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * Legitimate-access controls in the same file, each differing from the harm
 * case in exactly one property:
 *   - a transfer UNDER the configured cap still goes through (a fix that simply
 *     blocked transfers would fail here);
 *   - with NO cap configured, the platform default still applies and a large
 *     transfer still succeeds, so nothing new is blocked by accident;
 *   - the saved cap still reads back on the admin page, so the field is not
 *     disconnected in the other direction.
 */
final class F492MaxTransferCapIsAppliedTest extends TestCase
{
    use DatabaseTransactions;

    private int $adminId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(9611);
            $mock->shouldReceive('refreshAllOrFail')->andReturn(9612);
        });

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->adminId = (int) $admin->id;
        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $admin->id,
                $admin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);

        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', ['wallet.max_transaction', 'wallet.max_transfer'])
            ->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    /**
     * THE HARM: the cap the administrator set on the System Config page must be
     * the cap the wallet enforces.
     */
    public function test_the_transfer_cap_an_administrator_sets_is_enforced(): void
    {
        $this->apiPut('/v2/admin/enterprise/config', ['max_transaction' => 5])
            ->assertStatus(200);

        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $this->assertSame(
            5.0,
            app(WalletService::class)->maxTransferAmount($this->testTenantId),
            'The enforced ceiling must be the 5 hours the administrator set, not the '
            . 'platform default of 1,000 (F-492: the field saved to a key nothing reads).'
        );

        $sender = $this->memberWithBalance(500.0);
        $receiver = $this->memberWithBalance(0.0);

        $refused = false;
        try {
            app(WalletService::class)->transfer((int) $sender->id, [
                'recipient' => (int) $receiver->id,
                'amount' => 200.0,
                'description' => 'E075 F492 transfer far above the configured cap',
            ]);
        } catch (\InvalidArgumentException $e) {
            $refused = true;
        }

        $this->assertTrue(
            $refused,
            'A 200-hour transfer must be refused while the administrator has capped transfers at 5.'
        );
        $this->assertSame(
            0.0,
            $this->balance($receiver),
            'No credit may move on a transfer that exceeds the administrator\'s cap.'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: a transfer UNDER the configured cap still goes
     * through. Without this, the fix would be indistinguishable from breaking
     * transfers altogether.
     */
    public function test_control_a_transfer_under_the_configured_cap_still_succeeds(): void
    {
        $this->apiPut('/v2/admin/enterprise/config', ['max_transaction' => 5])
            ->assertStatus(200);

        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $sender = $this->memberWithBalance(500.0);
        $receiver = $this->memberWithBalance(0.0);

        app(WalletService::class)->transfer((int) $sender->id, [
            'recipient' => (int) $receiver->id,
            'amount' => 3.0,
            'description' => 'E075 F492 control transfer below the configured cap',
        ]);

        $this->assertSame(
            3.0,
            $this->balance($receiver),
            'CONTROL: an ordinary transfer within the cap must still land.'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: with no cap configured, nothing new is blocked
     * — the platform default of 1,000 hours still applies.
     */
    public function test_control_with_no_cap_configured_the_platform_default_still_applies(): void
    {
        $this->assertSame(
            1000.0,
            app(WalletService::class)->maxTransferAmount($this->testTenantId),
            'CONTROL: an unconfigured community keeps the platform ceiling.'
        );

        $sender = $this->memberWithBalance(500.0);
        $receiver = $this->memberWithBalance(0.0);

        app(WalletService::class)->transfer((int) $sender->id, [
            'recipient' => (int) $receiver->id,
            'amount' => 200.0,
            'description' => 'E075 F492 control transfer with no cap configured',
        ]);

        $this->assertSame(
            200.0,
            $this->balance($receiver),
            'CONTROL: with no cap set, a 200-hour transfer must still be allowed.'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL: the administrator still sees the cap they saved
     * when the page reloads. Moving the field to a different storage key must
     * not break the round trip.
     */
    public function test_control_the_saved_cap_reads_back_on_the_admin_page(): void
    {
        $this->apiPut('/v2/admin/enterprise/config', ['max_transaction' => 5])
            ->assertStatus(200);

        $response = $this->apiGet('/v2/admin/enterprise/config');
        $response->assertStatus(200);

        $body = json_decode((string) $response->getContent(), true);

        $this->assertSame(
            5,
            (int) ($body['data']['max_transaction'] ?? 0),
            'CONTROL: the System Config page must still read back the cap it saved.'
        );
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function memberWithBalance(float $balance): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => $balance,
        ]);
    }

    private function balance(User $user): float
    {
        return (float) DB::table('users')
            ->where('id', (int) $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->value('balance');
    }
}
