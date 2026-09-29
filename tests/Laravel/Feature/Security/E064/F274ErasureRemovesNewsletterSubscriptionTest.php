<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\NewsletterService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-274 (E-062 slice F, F-1): Article 17 erasure must take the member off the
 * community newsletter — `newsletter_subscribers` and the unsent
 * `newsletter_queue` rows hold their real email and name in plaintext columns
 * of their own — and must NOT delete the platform-wide `email_suppression`
 * row for their address, which is the record that stops delivery.
 *
 * Every assertion reads the rows back, so a schema mistake in the erasure
 * statements cannot pass as a swallowed no-op.
 */
class F274ErasureRemovesNewsletterSubscriptionTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $originalStoragePath = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalStoragePath = getenv('STORAGE_PATH') ?: null;
        putenv('STORAGE_PATH=' . rtrim(sys_get_temp_dir(), '/\\') . '/f274-erasure-' . getmypid());
    }

    protected function tearDown(): void
    {
        if ($this->originalStoragePath === null) {
            putenv('STORAGE_PATH');
        } else {
            putenv('STORAGE_PATH=' . $this->originalStoragePath);
        }
        parent::tearDown();
    }

    private function member(string $email): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'first_name' => 'Realfirst',
            'last_name' => 'Reallast',
            'name' => 'Realfirst Reallast',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function subscribe(int $tenantId, string $email, ?int $userId): void
    {
        DB::table('newsletter_subscribers')->insert([
            'tenant_id' => $tenantId,
            'email' => $email,
            'user_id' => $userId,
            'first_name' => 'Realfirst',
            'last_name' => 'Reallast',
            'status' => 'active',
            'unsubscribe_token' => bin2hex(random_bytes(16)),
            'is_active' => 1,
        ]);
    }

    private function newsletter(int $tenantId, int $createdBy): int
    {
        return (int) DB::table('newsletters')->insertGetId([
            'tenant_id' => $tenantId,
            'subject' => 'F-274 fixture newsletter',
            'content' => '<p>fixture</p>',
            'created_by' => $createdBy,
        ]);
    }

    private function queueRow(int $tenantId, int $newsletterId, ?int $userId, string $email, string $status): int
    {
        return (int) DB::table('newsletter_queue')->insertGetId([
            'tenant_id' => $tenantId,
            'newsletter_id' => $newsletterId,
            'user_id' => $userId,
            'email' => $email,
            'name' => 'Realfirst Reallast',
            'first_name' => 'Realfirst',
            'last_name' => 'Reallast',
            'status' => $status,
            'sent_at' => $status === 'sent' ? now() : null,
        ]);
    }

    private function uniqueEmail(string $label): string
    {
        return 'f274-' . $label . '-' . bin2hex(random_bytes(6)) . '@example.test';
    }

    public function test_erasure_removes_the_subscription_and_keeps_the_suppression_row(): void
    {
        $email = $this->uniqueEmail('erased');
        $user = $this->member($email);
        $this->subscribe($this->testTenantId, $email, (int) $user->id);

        DB::table('email_suppression')->insert([
            'email' => $email,
            'reason' => 'bounce',
            'suppressed_at' => now(),
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        // Control: the erasure ran and did its documented job.
        $this->assertSame('Deleted User', DB::table('users')->where('id', $user->id)->value('name'));

        $this->assertSame(
            0,
            DB::table('newsletter_subscribers')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->count(),
            'the erased member must not remain on the newsletter list'
        );
        $this->assertSame(
            0,
            DB::table('newsletter_subscribers')->where('tenant_id', $this->testTenantId)->where('email', $email)->count(),
            'the erased member real email must not survive in newsletter_subscribers'
        );
        $this->assertSame(
            1,
            DB::table('email_suppression')->where('email', $email)->count(),
            'erasure must not remove the record that stops delivery to this address'
        );
    }

    public function test_an_unlinked_subscription_under_the_same_email_is_removed_too(): void
    {
        // An imported or pre-registration subscription carries the address but
        // no user_id. It is the same person's data and goes with the erasure.
        $email = $this->uniqueEmail('unlinked');
        $user = $this->member($email);
        $this->subscribe($this->testTenantId, $email, null);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        $this->assertSame(
            0,
            DB::table('newsletter_subscribers')->where('tenant_id', $this->testTenantId)->where('email', $email)->count()
        );
    }

    public function test_an_erased_member_is_no_longer_a_newsletter_recipient(): void
    {
        $email = $this->uniqueEmail('recipient');
        $user = $this->member($email);
        $this->subscribe($this->testTenantId, $email, (int) $user->id);

        $before = array_column(NewsletterService::getRecipients('subscribers_only'), 'email');
        $this->assertContains($email, $before, 'precondition: subscribed before erasure');

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        $after = array_column(NewsletterService::getRecipients('subscribers_only'), 'email');
        $this->assertNotContains($email, $after);
    }

    public function test_unsent_queue_rows_are_removed_and_sent_rows_lose_the_real_address(): void
    {
        $email = $this->uniqueEmail('queued');
        $user = $this->member($email);
        $newsletterId = $this->newsletter($this->testTenantId, (int) $user->id);

        $pendingId = $this->queueRow($this->testTenantId, $newsletterId, (int) $user->id, $email, 'pending');
        $failedId = $this->queueRow($this->testTenantId, $newsletterId, (int) $user->id, $email, 'failed');
        $sentId = $this->queueRow($this->testTenantId, $newsletterId, (int) $user->id, $email, 'sent');

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $user->id);

        $this->assertSame(0, DB::table('newsletter_queue')->whereIn('id', [$pendingId, $failedId])->count(),
            'an unsent newsletter addressed to the erased member must not go out');

        $sent = DB::table('newsletter_queue')->where('id', $sentId)->first();
        $this->assertNotNull($sent, 'the delivery record stays for the newsletter statistics');
        $this->assertNotSame($email, $sent->email);
        $this->assertStringContainsString('@anonymized.local', (string) $sent->email);
        $this->assertSame('', (string) $sent->name);
        $this->assertSame('', (string) $sent->first_name);
        $this->assertSame('', (string) $sent->last_name);
        $this->assertSame('sent', (string) $sent->status);
    }

    public function test_control_bystanders_and_other_communities_are_untouched(): void
    {
        $victimEmail = $this->uniqueEmail('victim');
        $bystanderEmail = $this->uniqueEmail('bystander');
        $victim = $this->member($victimEmail);
        $bystander = $this->member($bystanderEmail);
        $this->subscribe($this->testTenantId, $victimEmail, (int) $victim->id);
        $this->subscribe($this->testTenantId, $bystanderEmail, (int) $bystander->id);

        // The same address subscribed to another community's newsletter is that
        // community's record; erasure here is scoped to this community.
        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $otherTenantId);
        $this->subscribe($otherTenantId, $victimEmail, null);

        $newsletterId = $this->newsletter($this->testTenantId, (int) $bystander->id);
        $bystanderQueueId = $this->queueRow($this->testTenantId, $newsletterId, (int) $bystander->id, $bystanderEmail, 'pending');

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $victim->id);

        $row = DB::table('newsletter_subscribers')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $bystander->id)
            ->first();
        $this->assertNotNull($row);
        $this->assertSame($bystanderEmail, $row->email);
        $this->assertSame('active', (string) $row->status);

        $this->assertSame(1, DB::table('newsletter_subscribers')
            ->where('tenant_id', $otherTenantId)->where('email', $victimEmail)->count());

        $queued = DB::table('newsletter_queue')->where('id', $bystanderQueueId)->first();
        $this->assertNotNull($queued);
        $this->assertSame($bystanderEmail, $queued->email);
        $this->assertSame('pending', (string) $queued->status);

        $this->assertContains(
            $bystanderEmail,
            array_column(NewsletterService::getRecipients('subscribers_only'), 'email')
        );
    }
}
