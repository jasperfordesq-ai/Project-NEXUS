<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\HowToPay;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * "How to pay": one plain-text note per payee, written once by whoever is
 * paid and shown to the communities that pay them (owner, 23 November 2026).
 *
 * Pinned here: what is stored, who may write a note (the platform team for the
 * platform's; a manager for its own community's or one below, never above or
 * beside), and that a community is told only the note of the payee it pays.
 *
 * Tree:  hub ─ child ─ grandchild        other (a second hub, beside `hub`)
 *            └ sibling                    direct (a community directly under the platform)
 */
final class HowToPayNoteTest extends TestCase
{
    use DatabaseTransactions;

    private const PLATFORM_URL = '/v2/admin/super/billing/how-to-pay';

    private int $hub;
    private int $child;
    private int $grandchild;
    private int $sibling;
    private int $other;
    private int $direct;

    protected function setUp(): void
    {
        parent::setUp();

        $this->hub = $this->makeCommunity('Note hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Note child', $this->hub, "/1/{$this->hub}/", true);
        $this->grandchild = $this->makeCommunity('Note grandchild', $this->child, "/1/{$this->hub}/{$this->child}/");
        $this->sibling = $this->makeCommunity('Note sibling', $this->hub, "/1/{$this->hub}/", true);
        $this->other = $this->makeCommunity('Note other hub', 1, '/1/', true);
        $this->direct = $this->makeCommunity('Note direct', 1, '/1/');

        // Whatever the local database holds for the platform is not this test's.
        DB::table('billing_how_to_pay_notes')->delete();

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            PlanTerms::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'note-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count($parentPath, '/') - 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function signInTo(int $tenantId, array $attributes): User
    {
        $this->testTenantId = $tenantId;

        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($tenantId);
        SuperPanelAccess::reset();

        return $user;
    }

    private function asManagerOf(int $tenantId): User
    {
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => true]);
    }

    private function asPlatformTeam(): User
    {
        return $this->signInTo($this->hub, ['role' => 'admin', 'is_super_admin' => true, 'is_god' => true]);
    }

    private function asAdminOf(int $tenantId): User
    {
        return $this->signInTo($tenantId, ['role' => 'admin', 'is_admin' => 1]);
    }

    // ── What is stored ──────────────────────────────────────────────────────

    public function test_a_note_is_kept_as_plain_text_and_tidied(): void
    {
        $saved = HowToPay::set($this->hub, "  Pay by bank transfer.\r\n\r\n\r\n\r\nIBAN IE00 TEST 0000\t \nQuote your community's name.\x07  ", 7);

        $this->assertSame("Pay by bank transfer.\n\nIBAN IE00 TEST 0000\nQuote your community's name.", $saved);
        $this->assertSame($saved, HowToPay::forPayee($this->hub));
        $this->assertSame(7, (int) DB::table('billing_how_to_pay_notes')->where('payee_tenant_id', $this->hub)->value('updated_by_user_id'));
    }

    public function test_markup_is_stored_as_the_text_it_is_and_never_turned_into_anything(): void
    {
        $note = '<script>alert(1)</script> <a href="https://example.test">pay here</a>';

        $this->assertSame($note, HowToPay::set($this->hub, $note, 7));
    }

    public function test_an_empty_note_or_null_removes_it(): void
    {
        HowToPay::set($this->hub, 'Pay by bank transfer.', 7);

        $this->assertNull(HowToPay::set($this->hub, "  \n ", 7));
        $this->assertNull(HowToPay::forPayee($this->hub));
        $this->assertSame(0, DB::table('billing_how_to_pay_notes')->where('payee_tenant_id', $this->hub)->count());

        HowToPay::set($this->hub, 'Pay by bank transfer.', 7);
        $this->assertNull(HowToPay::set($this->hub, null, 7));
        $this->assertNull(HowToPay::forPayee($this->hub));
    }

    public function test_a_note_past_the_limit_is_refused_not_cut_short(): void
    {
        HowToPay::set($this->hub, 'Pay by bank transfer.', 7);

        try {
            HowToPay::set($this->hub, str_repeat('a', HowToPay::MAX + 1), 7);
            $this->fail('A note that is too long was accepted.');
        } catch (\DomainException $e) {
            $this->assertSame(HowToPay::TOO_LONG, $e->getMessage());
        }

        $this->assertSame('Pay by bank transfer.', HowToPay::forPayee($this->hub), 'The note it had is kept.');
        $this->assertSame(str_repeat('é', HowToPay::MAX), HowToPay::set($this->hub, str_repeat('é', HowToPay::MAX), 7), 'Counted in characters, not bytes.');
    }

    public function test_something_that_is_not_text_is_refused(): void
    {
        HowToPay::set($this->hub, 'Pay by bank transfer.', 7);

        foreach ([['an', 'array'], 42, true, "broken \xC3\x28 text"] as $notText) {
            try {
                HowToPay::set($this->hub, $notText, 7);
                $this->fail('A value that is not text was accepted.');
            } catch (\DomainException $e) {
                $this->assertSame(HowToPay::NOT_TEXT, $e->getMessage());
            }
        }

        $this->assertSame('Pay by bank transfer.', HowToPay::forPayee($this->hub));
    }

    public function test_a_change_is_kept_in_the_payees_billing_record_with_what_it_said_before(): void
    {
        HowToPay::set($this->hub, 'First.', 7);
        HowToPay::set($this->hub, 'Second.', 8);
        HowToPay::set($this->hub, 'Second.', 9);

        $log = DB::table('billing_audit_log')->where('tenant_id', $this->hub)->where('action', 'how_to_pay_note_set')->orderBy('id')->get();

        $this->assertCount(2, $log, 'Saving the same words again changes nothing and records nothing.');
        $this->assertSame(['note' => null], json_decode((string) $log[0]->old_value, true));
        $this->assertSame(['note' => 'First.'], json_decode((string) $log[1]->old_value, true));
        $this->assertSame(['note' => 'Second.'], json_decode((string) $log[1]->new_value, true));
        $this->assertSame(8, (int) $log[1]->acted_by_user_id);
    }

    // ── Whose note a community is told ──────────────────────────────────────

    public function test_a_community_is_told_the_note_of_whoever_it_pays_by_hand_and_no_other(): void
    {
        HowToPay::set(HowToPay::PLATFORM, 'The platform: pay by bank transfer.', 7);
        HowToPay::set($this->hub, 'The hub: pay by cheque.', 7);
        HowToPay::set($this->other, 'Another hub: pay in cash.', 7);

        // Under a parent community, it pays that parent by default.
        $this->assertSame('parent', BillingStandingService::get($this->child)['payer']);
        $this->assertSame($this->hub, HowToPay::payeeFor($this->child));
        $this->assertSame('The hub: pay by cheque.', HowToPay::forCommunity($this->child));

        // Directly under the platform, it pays the platform by invoice.
        $this->assertSame(HowToPay::PLATFORM, HowToPay::payeeFor($this->direct));
        $this->assertSame('The platform: pay by bank transfer.', HowToPay::forCommunity($this->direct));

        // The grandchild pays the child, which has written nothing: it is not
        // handed the note of the hub above, or the platform's.
        $this->assertSame($this->child, HowToPay::payeeFor($this->grandchild));
        $this->assertNull(HowToPay::forCommunity($this->grandchild));
    }

    public function test_a_card_payer_and_a_community_nobody_bills_are_told_no_note(): void
    {
        HowToPay::set(HowToPay::PLATFORM, 'The platform: pay by bank transfer.', 7);
        HowToPay::set($this->hub, 'The hub: pay by cheque.', 7);

        BillingStandingService::setPayer($this->child, 'platform_card', 7);
        $this->assertNull(HowToPay::payeeFor($this->child));
        $this->assertNull(HowToPay::forCommunity($this->child));

        BillingStandingService::setPayer($this->child, 'not_billed', 7);
        $this->assertNull(HowToPay::forCommunity($this->child));

        // Moved to pay the platform by invoice: the platform's note, not its parent's.
        BillingStandingService::setPayer($this->child, 'platform_invoice', 7);
        $this->assertSame('The platform: pay by bank transfer.', HowToPay::forCommunity($this->child));

        $this->assertNull(HowToPay::payeeFor(1), 'The platform itself pays no one.');
    }

    // ── The platform's note: the platform team only ─────────────────────────

    public function test_the_platform_team_reads_and_writes_the_platforms_note(): void
    {
        $member = $this->asPlatformTeam();

        $this->apiGet(self::PLATFORM_URL)->assertStatus(200)
            ->assertJsonPath('data.how_to_pay', null)
            ->assertJsonPath('data.how_to_pay_max', HowToPay::MAX);

        $this->apiPut(self::PLATFORM_URL, ['note' => " Pay by bank transfer.\nIBAN IE00 TEST 0000 "])
            ->assertStatus(200)
            ->assertJsonPath('data.how_to_pay', "Pay by bank transfer.\nIBAN IE00 TEST 0000");

        $this->assertSame("Pay by bank transfer.\nIBAN IE00 TEST 0000", HowToPay::forPayee(HowToPay::PLATFORM));
        $this->assertSame((int) $member->id, (int) DB::table('billing_how_to_pay_notes')->where('payee_tenant_id', 1)->value('updated_by_user_id'));

        $this->apiPut(self::PLATFORM_URL, ['note' => null])->assertStatus(200)->assertJsonPath('data.how_to_pay', null);
        $this->assertNull(HowToPay::forPayee(HowToPay::PLATFORM));
    }

    public function test_nobody_but_the_platform_team_reaches_the_platforms_note(): void
    {
        HowToPay::set(HowToPay::PLATFORM, 'The platform: pay by bank transfer.', 7);

        $others = [
            'a global super admin who is not on the team' => fn () => $this->signInTo($this->hub, ['role' => 'admin', 'is_super_admin' => true, 'is_god' => false]),
            'a manager of a parent community' => fn () => $this->asManagerOf($this->hub),
            'a community admin' => fn () => $this->asAdminOf($this->direct),
        ];

        foreach ($others as $who => $signIn) {
            $signIn();

            $this->assertSame(403, $this->apiGet(self::PLATFORM_URL)->getStatusCode(), "{$who} read it");
            $this->assertSame(403, $this->apiPut(self::PLATFORM_URL, ['note' => 'Pay me instead.'])->getStatusCode(), "{$who} wrote it");
        }

        $this->assertSame('The platform: pay by bank transfer.', HowToPay::forPayee(HowToPay::PLATFORM));
    }

    public function test_the_address_explains_a_note_that_cannot_be_saved(): void
    {
        $this->asPlatformTeam();

        $this->apiPut(self::PLATFORM_URL, ['note' => str_repeat('a', HowToPay::MAX + 1)])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'HOW_TO_PAY_TOO_LONG')
            ->assertJsonPath('errors.0.field', 'note');

        // Not saying `note` at all is a mistake, not an instruction to remove it.
        HowToPay::set(HowToPay::PLATFORM, 'Keep me.', 7);
        $this->apiPut(self::PLATFORM_URL, [])->assertStatus(422)->assertJsonPath('errors.0.code', 'HOW_TO_PAY_NOT_TEXT');
        $this->apiPut(self::PLATFORM_URL, ['note' => ['not', 'text']])->assertStatus(422)->assertJsonPath('errors.0.code', 'HOW_TO_PAY_NOT_TEXT');
        $this->assertSame('Keep me.', HowToPay::forPayee(HowToPay::PLATFORM));
    }

    // ── A parent community's note: its own manager, or one above ────────────

    public function test_a_manager_writes_its_own_communitys_note_and_branch_plans_shows_it(): void
    {
        $manager = $this->asManagerOf($this->hub);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/how-to-pay", ['note' => 'Pay by cheque to Note hub.'])
            ->assertStatus(200)
            ->assertJsonPath('data.how_to_pay', 'Pay by cheque to Note hub.');

        $this->assertSame((int) $manager->id, (int) DB::table('billing_how_to_pay_notes')->where('payee_tenant_id', $this->hub)->value('updated_by_user_id'));

        $this->apiGet("/v2/admin/super/branch-plans?hub_id={$this->hub}")
            ->assertStatus(200)
            ->assertJsonPath('data.how_to_pay', 'Pay by cheque to Note hub.')
            ->assertJsonPath('data.how_to_pay_max', HowToPay::MAX);
    }

    public function test_a_manager_above_writes_the_note_of_a_parent_community_below_it(): void
    {
        $this->asManagerOf($this->hub);

        $this->apiPut("/v2/admin/super/branch-plans/{$this->child}/how-to-pay", ['note' => 'Pay the child.'])->assertStatus(200);

        $this->assertSame('Pay the child.', HowToPay::forPayee($this->child));
    }

    public function test_a_manager_cannot_write_a_note_above_it_beside_it_or_for_the_platform(): void
    {
        HowToPay::set(HowToPay::PLATFORM, 'The platform: pay by bank transfer.', 7);
        HowToPay::set($this->hub, 'The hub: pay by cheque.', 7);
        $this->asManagerOf($this->child);

        $notInReach = [
            'its parent' => $this->hub,
            'a sibling' => $this->sibling,
            'another hub' => $this->other,
            'the platform' => 1,
            'a community that does not exist' => 999999991,
        ];

        foreach ($notInReach as $what => $target) {
            $response = $this->apiPut("/v2/admin/super/branch-plans/{$target}/how-to-pay", ['note' => 'Pay me instead.']);
            $this->assertSame(404, $response->getStatusCode(), "{$what} was written to");
        }

        $this->assertSame('The platform: pay by bank transfer.', HowToPay::forPayee(HowToPay::PLATFORM));
        $this->assertSame('The hub: pay by cheque.', HowToPay::forPayee($this->hub));
        $this->assertNull(HowToPay::forPayee($this->sibling));
        $this->assertNull(HowToPay::forPayee($this->other));
    }

    public function test_a_community_admin_who_is_not_a_manager_cannot_write_a_note(): void
    {
        $this->asAdminOf($this->hub);

        $status = $this->apiPut("/v2/admin/super/branch-plans/{$this->hub}/how-to-pay", ['note' => 'Pay me instead.'])->getStatusCode();

        $this->assertContains($status, [401, 403]);
        $this->assertNull(HowToPay::forPayee($this->hub));
    }

    // ── What a community's own Billing page is sent ─────────────────────────

    public function test_the_standing_answer_names_who_it_pays_and_carries_their_note_while_open(): void
    {
        HowToPay::set($this->hub, "Pay by cheque.\nPost it to the hub.", 7);
        $this->asAdminOf($this->child);

        $response = $this->apiGet('/v2/admin/billing/standing')->assertStatus(200);

        $response->assertJsonPath('data.paused', false);
        $response->assertJsonPath('data.payer', 'parent');
        $response->assertJsonPath('data.payee_name', 'Note hub');
        $response->assertJsonPath('data.how_to_pay', "Pay by cheque.\nPost it to the hub.");
    }

    public function test_the_standing_answer_carries_the_platforms_note_for_an_invoice_payer_and_none_for_a_card_payer(): void
    {
        HowToPay::set(HowToPay::PLATFORM, 'The platform: pay by bank transfer.', 7);
        $this->asAdminOf($this->direct);

        $this->apiGet('/v2/admin/billing/standing')->assertStatus(200)
            ->assertJsonPath('data.payer', 'platform_invoice')
            ->assertJsonPath('data.payee_name', null)
            ->assertJsonPath('data.how_to_pay', 'The platform: pay by bank transfer.');

        BillingStandingService::setPayer($this->direct, 'platform_card', 7);

        $this->apiGet('/v2/admin/billing/standing')->assertStatus(200)->assertJsonPath('data.how_to_pay', null);
    }

    public function test_a_community_paused_from_above_is_told_nobodys_name_and_nobodys_note(): void
    {
        HowToPay::set($this->child, 'Pay the child.', 7);
        BillingStandingService::suspend($this->hub, 7, 'manual');
        BillingLock::flush();
        $this->asAdminOf($this->grandchild);

        $this->apiGet('/v2/admin/billing/standing')->assertStatus(200)
            ->assertJsonPath('data.paused', true)
            ->assertJsonPath('data.own', false)
            ->assertJsonPath('data.payee_name', null)
            ->assertJsonPath('data.how_to_pay', null);
    }

    // ── A community's own payments ──────────────────────────────────────────

    public function test_a_communitys_admins_see_its_payments_and_nothing_about_who_recorded_them(): void
    {
        $recorder = $this->asPlatformTeam();
        BillingStandingService::recordPayment($this->direct, [
            'received_on' => '2026-11-02', 'method' => 'bank_transfer', 'reference' => 'INTERNAL NOTE 114',
            'amount' => '480.00', 'currency' => 'EUR', 'paid_until' => '2027-10-31',
        ], (int) $recorder->id);
        $voided = BillingStandingService::recordPayment($this->direct, [
            'received_on' => '2026-11-03', 'method' => 'cash', 'paid_until' => '2027-11-30',
        ], (int) $recorder->id);
        BillingStandingService::voidPayment($this->direct, $voided, (int) $recorder->id, 'Recorded twice by mistake.');

        $this->asAdminOf($this->direct);
        $response = $this->apiGet('/v2/admin/billing/payments')->assertStatus(200);
        $payments = $response->json('data');

        $this->assertCount(2, $payments);
        $this->assertSame(
            ['id', 'received_on', 'method', 'amount', 'currency', 'paid_until_after', 'source', 'paid_to', 'voided', 'refunded_amount'],
            array_keys($payments[0]),
        );
        // Newest first.
        $this->assertSame('2026-11-03', $payments[0]['received_on']);
        $this->assertTrue($payments[0]['voided']);
        $this->assertSame('2026-11-02', $payments[1]['received_on']);
        $this->assertSame('bank_transfer', $payments[1]['method']);
        $this->assertSame('480.00', $payments[1]['amount']);
        $this->assertSame('EUR', $payments[1]['currency']);
        $this->assertSame('2027-10-31', $payments[1]['paid_until_after']);
        $this->assertSame('manual', $payments[1]['source']);
        $this->assertSame('platform', $payments[1]['paid_to']);
        $this->assertFalse($payments[1]['voided']);

        // The recorder's reference, the reason for a void and every name stay
        // with whoever wrote them.
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('INTERNAL NOTE 114', $body);
        $this->assertStringNotContainsString('Recorded twice by mistake', $body);
        $this->assertStringNotContainsString((string) $recorder->last_name, $body);
    }

    public function test_a_community_sees_only_its_own_payments(): void
    {
        $recorder = $this->asPlatformTeam();
        BillingStandingService::recordPayment($this->direct, [
            'received_on' => '2026-11-02', 'method' => 'bank_transfer', 'paid_until' => '2027-10-31',
        ], (int) $recorder->id);

        $this->asAdminOf($this->other);

        $this->apiGet('/v2/admin/billing/payments')->assertStatus(200)->assertJsonPath('data', []);
    }

    public function test_a_member_cannot_read_the_payments(): void
    {
        $this->signInTo($this->direct, ['role' => 'member']);

        $this->assertContains($this->apiGet('/v2/admin/billing/payments')->getStatusCode(), [401, 403]);
    }
}
