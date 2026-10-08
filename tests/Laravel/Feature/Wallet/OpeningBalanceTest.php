<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Wallet;

use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\StartingBalanceService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Services\WalletService;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A member imported from another timebank carries an `opening_balance` ledger
 * row. It must count as "welcome credits already given" (owner, 8 Oct 2026:
 * imported members never also get the community's welcome credits) and read
 * sensibly in the member's wallet history.
 */
final class OpeningBalanceTest extends TestCase
{
    use DatabaseTransactions;

    private function importedMember(int $cents, ?int $originalCents = null): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'pending', 'balance' => 0]);
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => 0, 'receiver_id' => $user->id,
            'amount' => OpeningBalance::formatCents($cents),
            'description' => OpeningBalance::describe('AB12CD34', $originalCents),
            'status' => 'completed', 'transaction_type' => OpeningBalance::TYPE,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('users')->where('id', $user->id)->update(['balance' => OpeningBalance::formatCents($cents)]);

        return $user->refresh();
    }

    public function test_an_opening_balance_counts_as_welcome_credits_already_given(): void
    {
        // getStartingBalance() falls back to 5 when the tenant sets nothing, so a
        // grant would happen here without the opening_balance check.
        $user = $this->importedMember(1250);

        StartingBalanceService::applyToNewUser($user->id);

        $this->assertSame('12.50', (string) DB::table('users')->where('id', $user->id)->value('balance'));
        $this->assertFalse(DB::table('transactions')->where('receiver_id', $user->id)->where('transaction_type', 'starting_balance')->exists());
    }

    public function test_a_zero_opening_balance_also_blocks_welcome_credits(): void
    {
        $user = $this->importedMember(0, -300);

        StartingBalanceService::applyToNewUser($user->id);

        $this->assertSame('0.00', (string) DB::table('users')->where('id', $user->id)->value('balance'));
    }

    public function test_the_description_round_trips_the_original_negative_balance(): void
    {
        $this->assertSame(-300, OpeningBalance::originalCentsFrom(OpeningBalance::describe('AB12CD34', -300)));
        $this->assertNull(OpeningBalance::originalCentsFrom(OpeningBalance::describe('AB12CD34', null)));
        $this->assertNull(OpeningBalance::originalCentsFrom('free text a member wrote'));
        $this->assertSame('100000.00', OpeningBalance::formatCents(10_000_000));
        $this->assertSame('0.05', OpeningBalance::formatCents(5));
    }

    public function test_the_wallet_shows_a_translated_label_not_the_stored_text(): void
    {
        $user = $this->importedMember(0, -300);

        // formatTransaction() is private (WalletService.php:1102); read the row
        // through the member's own wallet history, as the app does.
        $row = $this->walletRowFor($user);

        $this->assertSame(__('api.wallet_opening_balance_was_negative', ['amount' => '-3.00']), $row['description']);
        $this->assertSame(__('api.wallet_counterparty_previous_timebank'), $row['other_user']['name']);
    }

    public function test_the_wallet_shows_the_plain_label_when_no_negative_original_was_recorded(): void
    {
        $user = $this->importedMember(1250);

        $row = $this->walletRowFor($user);

        $this->assertSame(__('api.wallet_opening_balance'), $row['description']);
        $this->assertStringNotContainsString('import AB12CD34', (string) $row['description']);
    }

    public function test_the_wallet_label_is_translated_into_the_members_language(): void
    {
        $user = $this->importedMember(1250);
        $previous = app()->getLocale();

        try {
            app()->setLocale('en');
            $english = $this->walletRowFor($user);
            app()->setLocale('de');
            $german = $this->walletRowFor($user);
        } finally {
            app()->setLocale($previous);
        }

        $this->assertNotSame($english['description'], $german['description']);
        $this->assertNotSame($english['other_user']['name'], $german['other_user']['name']);
        $this->assertSame('Anfangssaldo aus deiner früheren Zeitbank übernommen', $german['description']);
    }

    /**
     * The admin-approval path (AdminUsersController::grantWelcomeCredits) has its own
     * copy of the "already granted" predicate; it must also recognise opening_balance.
     */
    public function test_admin_approval_gives_an_imported_member_no_welcome_credits(): void
    {
        app(TenantSettingsService::class)->set($this->testTenantId, 'wallet.starting_balance', '5', 'float');
        app()->instance(EmailDispatchService::class, new OpeningBalanceSilentEmailDispatch());

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $imported = $this->importedMember(1250);
        DB::table('users')->where('id', $imported->id)->update(['is_approved' => 0, 'email_verified_at' => now()]);
        // Control: an ordinary applicant on the same tenant, same setting, IS granted credits.
        $ordinary = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false, 'email_verified_at' => now(), 'balance' => 0,
        ]);

        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);

        $response = $this->apiPost('/v2/admin/users/' . $imported->id . '/approve');
        $response->assertStatus(200);
        $response->assertJsonPath('data.welcome_credits', 0);
        $this->assertSame('12.50', (string) DB::table('users')->where('id', $imported->id)->value('balance'));
        $this->assertFalse(DB::table('transactions')->where('receiver_id', $imported->id)->where('transaction_type', 'starting_balance')->exists());

        $control = $this->apiPost('/v2/admin/users/' . $ordinary->id . '/approve');
        $control->assertStatus(200);
        $control->assertJsonPath('data.welcome_credits', 5);
    }

    /** @return array<string, mixed> */
    private function walletRowFor(User $user): array
    {
        $txnId = (int) DB::table('transactions')->where('receiver_id', $user->id)->value('id');
        $row = app(WalletService::class)->getTransaction($txnId, $user->id);
        $this->assertIsArray($row);

        return $row;
    }
}

/** Swallows the approval welcome email so the test sends nothing. */
final class OpeningBalanceSilentEmailDispatch extends EmailDispatchService
{
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        return true;
    }
}
