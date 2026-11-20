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
use App\Services\BillingStandingNotifier;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A paused community's admins are told by email, and told when it is restored.
 *
 * "Reached the mailer" is observed as elsewhere in this folder: Mailer writes
 * an email_log row for every attempt, sent or failed.
 */
final class BillingStandingNotifierTest extends TestCase
{
    use DatabaseTransactions;

    private int $hub;
    private int $child;
    private int $other;
    private string $hubName;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=0');

        $this->hubName = 'Notice hub ' . bin2hex(random_bytes(3));
        $this->hub = $this->makeCommunity($this->hubName, 1, '/1/', true);
        $this->child = $this->makeCommunity('Notice child', $this->hub, "/1/{$this->hub}/");
        $this->other = $this->makeCommunity('Notice other', $this->hub, "/1/{$this->hub}/");

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=30');

        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            SuperPanelAccess::reset();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'notice-' . bin2hex(random_bytes(5)),
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
    private function person(int $tenantId, array $attributes): string
    {
        $email = 'notice.' . bin2hex(random_bytes(6)) . '@example.com';
        User::factory()->forTenant($tenantId)->create(array_merge([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ], $attributes));

        return $email;
    }

    /** @return list<object> */
    private function mailTo(string $email): array
    {
        return DB::table('email_log')->where('recipient_email', $email)->orderBy('id')->get()->all();
    }

    public function test_every_admin_of_a_paused_community_is_told_and_nobody_else(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);
        $flagOnly = $this->person($this->child, ['role' => 'member', 'is_tenant_super_admin' => true]);
        $member = $this->person($this->child, ['role' => 'member']);
        $broker = $this->person($this->child, ['role' => 'broker']);
        $inactiveAdmin = $this->person($this->child, ['role' => 'admin', 'status' => 'suspended']);
        $elsewhere = $this->person($this->other, ['role' => 'admin']);

        BillingStandingService::suspend($this->child, null, 'manual');
        $sent = BillingStandingNotifier::paused($this->child);

        $this->assertSame(2, $sent);
        $this->assertCount(1, $this->mailTo($admin));
        $this->assertCount(1, $this->mailTo($flagOnly));
        foreach ([$member, $broker, $inactiveAdmin, $elsewhere] as $notTold) {
            $this->assertCount(0, $this->mailTo($notTold));
        }

        $row = $this->mailTo($admin)[0];
        $this->assertSame('billing', $row->category);
        $this->assertSame($this->child, (int) $row->tenant_id);
        $this->assertStringContainsString('Notice child', (string) $row->subject);
    }

    public function test_each_admin_is_told_in_their_own_language(): void
    {
        $english = $this->person($this->child, ['role' => 'admin', 'preferred_language' => 'en']);
        $french = $this->person($this->child, ['role' => 'admin', 'preferred_language' => 'fr']);

        BillingStandingService::suspend($this->child, null, 'manual');
        BillingStandingNotifier::paused($this->child);

        $this->assertStringContainsString('has been paused', (string) $this->mailTo($english)[0]->subject);
        $this->assertStringContainsString('en pause', (string) $this->mailTo($french)[0]->subject);
    }

    public function test_the_admins_are_told_when_it_is_restored(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);

        $sent = BillingStandingNotifier::restored($this->child);

        $this->assertSame(1, $sent);
        $this->assertStringContainsString('open again', (string) $this->mailTo($admin)[0]->subject);
    }

    public function test_a_community_with_no_admin_is_not_an_error(): void
    {
        $this->assertSame(0, BillingStandingNotifier::paused($this->child));
    }

    /**
     * Found by the Stage 2 review (20 Nov 2026): restoring a community's own
     * pause while a community above it is still paused sent its admins "your
     * community is open again" — and its members still saw the paused page.
     */
    public function test_nobody_is_told_it_is_open_again_while_a_community_above_is_still_paused(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);
        BillingStandingService::suspend($this->hub, null, 'manual');
        BillingStandingService::suspend($this->child, null, 'manual');

        $this->testTenantId = $this->hub;
        $manager = User::factory()->forTenant($this->hub)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'is_tenant_super_admin' => true,
        ]);
        Sanctum::actingAs($manager, ['*']);
        TenantContext::setById($this->hub);
        SuperPanelAccess::reset();

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/restore", [])->assertStatus(200);

        $this->assertNull(BillingStandingService::get($this->child)['suspended_at'], 'Its own pause is lifted.');
        $this->assertTrue(BillingLock::isLocked($this->child), 'It is still closed, because the hub is.');
        $this->assertCount(0, $this->mailTo($admin), 'Nobody is told it is open while it is not.');
    }

    public function test_every_language_has_every_billing_notice_with_the_same_placeholders(): void
    {
        $english = $this->billingStandingWording('en');

        foreach (['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as $locale) {
            $wording = $this->billingStandingWording($locale);
            $this->assertSame(array_keys($english), array_keys($wording), "{$locale}: keys differ");

            foreach ($english as $key => $text) {
                preg_match_all('/\{\{\w+\}\}/', $text, $want);
                preg_match_all('/\{\{\w+\}\}/', $wording[$key], $got);
                sort($want[0]);
                sort($got[0]);
                $this->assertSame($want[0], $got[0], "{$locale}.{$key}: placeholders differ");
                $this->assertNotSame($text, $wording[$key], "{$locale}.{$key} is still English");
            }
        }
    }

    public function test_a_member_limit_notice_says_how_many_members_the_limit_and_what_active_means(): void
    {
        $usage = __('emails_misc.billing_standing.limit_usage', [
            'community' => 'X', 'count' => '820', 'max' => '1000', 'plan' => 'Community',
        ]);
        $this->assertStringContainsString('820', $usage);
        $this->assertStringContainsString('1000', $usage);

        $note = __('emails_misc.billing_standing.active_member_note', ['days' => '90']);
        $this->assertStringContainsString('90 days', $note);
    }

    /** @return array<string, string> */
    private function billingStandingWording(string $locale): array
    {
        $all = json_decode((string) file_get_contents(base_path("lang/{$locale}/emails_misc.json")), true);

        return $all['billing_standing'];
    }

    /**
     * DESIGN §6.5: an AUTOMATIC pause tells the community's admins, whoever it
     * pays, and the platform team. Until Stage 3c a community that pays its
     * parent was paused without the platform team hearing of it.
     */
    public function test_an_automatic_pause_of_a_community_that_pays_its_parent_also_tells_the_platform_team(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);
        $manager = $this->person($this->hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);
        $team = $this->person($this->hub, ['role' => 'member', 'is_super_admin' => true, 'is_god' => true]);
        // On the platform team AND the parent's manager: one mail, not two.
        $both = $this->person($this->hub, ['role' => 'admin', 'is_tenant_super_admin' => true, 'is_super_admin' => true, 'is_god' => true]);
        $member = $this->person($this->hub, ['role' => 'member']);

        BillingStandingService::suspend($this->child, null, 'auto', null, 'non_payment');
        BillingStandingNotifier::paused($this->child, true, ['paid_until' => '2027-01-31', 'days_late' => 14]);

        foreach ([$admin, $manager, $team, $both] as $told) {
            $this->assertCount(1, $this->mailTo($told), 'told once');
        }
        $this->assertCount(0, $this->mailTo($member));
        $this->assertStringContainsString('Notice child', (string) $this->mailTo($team)[0]->subject);
    }

    public function test_a_pause_by_hand_does_not_tell_the_platform_team(): void
    {
        $team = $this->person($this->hub, ['role' => 'member', 'is_super_admin' => true, 'is_god' => true]);

        BillingStandingService::suspend($this->child, null, 'manual');
        BillingStandingNotifier::paused($this->child);

        $this->assertCount(0, $this->mailTo($team));
    }

    public function test_pausing_through_the_parents_page_tells_the_childs_admins_once(): void
    {
        $admin = $this->person($this->child, ['role' => 'admin']);

        $this->testTenantId = $this->hub;
        $manager = User::factory()->forTenant($this->hub)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'is_tenant_super_admin' => true,
        ]);
        Sanctum::actingAs($manager, ['*']);
        TenantContext::setById($this->hub);
        SuperPanelAccess::reset();

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/suspend", [])->assertStatus(200);
        // Pausing what is already paused changes nothing and tells nobody again.
        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/suspend", [])->assertStatus(200);

        $mail = $this->mailTo($admin);
        $this->assertCount(1, $mail);
        $this->assertStringContainsString('has been paused', (string) $mail[0]->subject);

        $this->apiPost("/v2/admin/super/branch-payments/{$this->child}/restore", [])->assertStatus(200);

        $mail = $this->mailTo($admin);
        $this->assertCount(2, $mail);
        $this->assertStringContainsString('open again', (string) $mail[1]->subject);
    }
}
