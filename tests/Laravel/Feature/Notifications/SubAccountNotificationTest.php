<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Notifications;

use App\Models\User;
use App\Services\SubAccountService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression tests for linked-account (sub-account) notification delivery.
 *
 * Root cause these pin down (reported by the owner, 2026-08-06):
 *
 *  1. SubAccountService wrote the bell row with Notification::create() directly.
 *     Nothing observes that table, so the member being asked to hand over
 *     control of their account got a bell entry and NO email and NO push. The
 *     fix routes both events through NotificationDispatcher, which is the only
 *     path that also reaches notification_queue.
 *  2. The bell link was plain '/settings', which opens the Profile tab. The
 *     recipient landed on a ten-tab page with no clue which tab held the
 *     request. It must carry ?tab=linked-accounts.
 *  3. Approval notified nobody at all, so the requester could not learn the
 *     answer except by revisiting the settings page.
 *
 * These assert on the queue row rather than a sent message because sending is
 * the cron runner's job; what the service owes is a correctly-shaped instant
 * queue row carrying a rendered HTML body.
 */
class SubAccountNotificationTest extends TestCase
{
    use DatabaseTransactions;

    private const EXPECTED_LINK = '/settings?tab=linked-accounts';

    private function actingUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function otherUser(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create($attributes);
    }

    private function bellFor(int $userId, string $type): ?object
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('type', $type)
            ->orderByDesc('id')
            ->first();
    }

    private function queueRowFor(int $userId, string $activityType): ?object
    {
        return DB::table('notification_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('activity_type', $activityType)
            ->orderByDesc('id')
            ->first();
    }

    private function insertPendingRelationship(int $parentId, int $childId, string $type = 'carer'): int
    {
        return (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parentId,
            'child_user_id' => $childId,
            'relationship_type' => $type,
            'permissions' => json_encode(SubAccountService::DEFAULT_PERMISSIONS),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  Request — the recipient must get a bell AND an email
    // ------------------------------------------------------------------

    public function test_request_bell_links_to_the_linked_accounts_tab(): void
    {
        $parent = $this->actingUser();
        $child = $this->otherUser();

        $this->apiPost('/v2/users/me/sub-accounts', [
            'child_user_id' => $child->id,
            'relationship_type' => 'guardian',
        ])->assertCreated();

        $bell = $this->bellFor($child->id, 'sub_account_request');

        $this->assertNotNull($bell, 'The child must receive a bell notification.');
        $this->assertSame(
            self::EXPECTED_LINK,
            $bell->link,
            'Plain /settings opens the Profile tab — the link must target the linked-accounts tab.',
        );
        $this->assertSame($parent->id, (int) DB::table('account_relationships')
            ->where('child_user_id', $child->id)
            ->value('parent_user_id'));
    }

    public function test_request_queues_an_instant_email_with_a_rendered_body(): void
    {
        $this->actingUser();
        $child = $this->otherUser();

        $this->apiPost('/v2/users/me/sub-accounts', [
            'child_user_id' => $child->id,
            'relationship_type' => 'carer',
        ])->assertCreated();

        $queued = $this->queueRowFor($child->id, 'sub_account_request');

        $this->assertNotNull(
            $queued,
            'No notification_queue row means no email — this is the defect the owner reported.',
        );
        $this->assertSame(
            'instant',
            $queued->frequency,
            'The digest default is off, so anything less than instant reaches nobody by email.',
        );
        $this->assertNotEmpty($queued->email_body, 'The queue row must carry a rendered HTML body.');
        $this->assertStringContainsString(
            self::EXPECTED_LINK,
            (string) $queued->email_body,
            'The email button must deep-link to the linked-accounts tab.',
        );
        $this->assertSame(self::EXPECTED_LINK, $queued->link);

        // A missing translation key renders as its own name, so the member would
        // receive an email containing "emails_notifications.sub_account.…".
        $this->assertStringNotContainsString(
            'emails_notifications.',
            (string) $queued->email_body,
            'An unresolved translation key leaked into the email body.',
        );
    }

    public function test_request_bell_text_uses_a_translated_relationship_label(): void
    {
        $this->actingUser();
        $child = $this->otherUser();

        $this->apiPost('/v2/users/me/sub-accounts', [
            'child_user_id' => $child->id,
            'relationship_type' => 'organization',
        ])->assertCreated();

        $bell = $this->bellFor($child->id, 'sub_account_request');

        $this->assertNotNull($bell);
        $this->assertStringNotContainsString(
            'organization',
            (string) $bell->message,
            'The raw enum value must not leak into member-facing text; use the translated label.',
        );
        $this->assertStringContainsString('Organisation', (string) $bell->message);
    }

    // ------------------------------------------------------------------
    //  Approval — the requester must be told
    // ------------------------------------------------------------------

    public function test_approval_notifies_the_requester(): void
    {
        $child = $this->actingUser();
        $parent = $this->otherUser(['first_name' => 'Approving', 'last_name' => 'Member']);
        $relationshipId = $this->insertPendingRelationship($parent->id, $child->id);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/approve")->assertOk();

        $bell = $this->bellFor($parent->id, 'sub_account_approved');
        $queued = $this->queueRowFor($parent->id, 'sub_account_approved');

        $this->assertNotNull($bell, 'Approval used to notify nobody — the requester must be told.');
        $this->assertSame(self::EXPECTED_LINK, $bell->link);
        $this->assertNotNull($queued, 'The approval must also reach the email queue.');
        $this->assertSame('instant', $queued->frequency);
        $this->assertNotEmpty($queued->email_body);
    }

    public function test_approval_notification_names_the_approving_member(): void
    {
        $child = $this->actingUser();
        $parent = $this->otherUser();
        $relationshipId = $this->insertPendingRelationship($parent->id, $child->id);

        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/approve")->assertOk();

        $bell = $this->bellFor($parent->id, 'sub_account_approved');
        $expectedName = trim($child->first_name . ' ' . $child->last_name);

        $this->assertNotNull($bell);
        $this->assertNotSame('', $expectedName);
        $this->assertStringContainsString($expectedName, (string) $bell->message);
    }

    public function test_a_failed_approval_notifies_nobody(): void
    {
        $child = $this->actingUser();
        $parent = $this->otherUser();

        // No pending row exists, so the approve call cannot succeed.
        $this->apiPut('/v2/users/me/sub-accounts/999999/approve')->assertStatus(422);

        $this->assertNull($this->bellFor($parent->id, 'sub_account_approved'));
        $this->assertNull($this->queueRowFor($parent->id, 'sub_account_approved'));
        $this->assertNull($this->bellFor($child->id, 'sub_account_approved'));
    }

    // ------------------------------------------------------------------
    //  Proxy actions (represent tier) — the member must learn by EMAIL too
    // ------------------------------------------------------------------

    private function ensureCategory(): int
    {
        $existing = DB::table('categories')->where('tenant_id', $this->testTenantId)->value('id');
        if ($existing) {
            return (int) $existing;
        }

        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Notification test category',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * 🔴 Until 2026-08-07 a carer could post in the member's name and the
     * member got a bell row only — no email, no push, and no NAME. Someone
     * else acting on your account is the event this whole feature's
     * accountability story hangs on: it must reach the member on every
     * channel, immediately, naming who did it.
     */
    public function test_proxy_listing_notifies_the_member_by_instant_email_naming_the_carer(): void
    {
        $carer = $this->actingUser();
        $member = $this->otherUser();
        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $carer->id,
            'child_user_id' => $member->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_view_activity' => true, 'can_manage_listings' => true]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost("/v2/users/me/sub-accounts/{$member->id}/listings", [
            'title' => 'Posted on their behalf',
            'description' => 'A listing created by the carer through the proxy endpoint.',
            'type' => 'offer',
            'category_id' => $this->ensureCategory(),
            'hours_estimate' => 1,
        ])->assertStatus(201);

        $carerName = trim($carer->first_name . ' ' . $carer->last_name);

        $bell = $this->bellFor($member->id, 'sub_account_proxy_listing');
        $this->assertNotNull($bell, 'The member must get a bell entry for a proxy listing.');
        $this->assertStringContainsString($carerName, (string) $bell->message, 'The bell must NAME the carer.');

        $queued = $this->queueRowFor($member->id, 'sub_account_proxy_listing');
        $this->assertNotNull($queued, 'No email queue row — the member would never learn by email.');
        $this->assertSame('instant', $queued->frequency, 'A proxy action must not wait for a digest.');
        $this->assertNotEmpty($queued->email_body);
        // e() the name: email_body is HTML, so a factory-generated name
        // containing an apostrophe (e.g. "D'Amore") is escaped to D&#039;Amore
        // and a raw-string search misses it. The escaped form is what the
        // recipient actually sees, and e() leaves ordinary names untouched, so
        // this asserts the same thing without depending on which name the
        // factory happened to pick.
        $this->assertStringContainsString(e($carerName), (string) $queued->email_body, 'The email must NAME the carer.');
        $this->assertStringNotContainsString('emails_notifications.', (string) $queued->email_body);
    }

    public function test_proxy_transfer_notifies_the_member_by_instant_email_naming_the_carer(): void
    {
        $carer = $this->actingUser();
        $member = $this->otherUser();
        $recipient = $this->otherUser();
        DB::table('users')->where('id', $member->id)->update(['balance' => 10]);
        DB::table('account_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $carer->id,
            'child_user_id' => $member->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['can_view_activity' => true, 'can_transact' => true]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPost("/v2/users/me/sub-accounts/{$member->id}/transfer", [
            'recipient' => $recipient->id,
            'amount' => 2,
        ])->assertOk();

        $carerName = trim($carer->first_name . ' ' . $carer->last_name);

        $bell = $this->bellFor($member->id, 'sub_account_proxy_transfer');
        $this->assertNotNull($bell, 'The member must get a bell entry when their credits are spent.');
        $this->assertStringContainsString($carerName, (string) $bell->message);

        $queued = $this->queueRowFor($member->id, 'sub_account_proxy_transfer');
        $this->assertNotNull($queued, 'Money left the account with no email — the exact defect this pins.');
        $this->assertSame('instant', $queued->frequency);
        // Escaped, for the same reason as the proxy-listing assertion above:
        // this is HTML, and an apostrophe in the name arrives as &#039;.
        $this->assertStringContainsString(e($carerName), (string) $queued->email_body);
    }

    // ------------------------------------------------------------------
    //  Delivery plumbing the email depends on
    // ------------------------------------------------------------------

    public function test_both_activity_types_have_their_own_email_subject(): void
    {
        foreach (['sub_account_request', 'sub_account_approved', 'sub_account_proxy_listing', 'sub_account_proxy_transfer'] as $activityType) {
            $key = "emails.notification_subject.{$activityType}";
            $subject = __($key);

            $this->assertNotSame(
                $key,
                $subject,
                "Missing {$key} — the instant email would fall back to the generic subject.",
            );
            $this->assertNotSame(__('emails.notification_subject.default'), $subject);
        }
    }
}
