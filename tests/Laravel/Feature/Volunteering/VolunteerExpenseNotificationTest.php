<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Models\VolExpense;
use App\Models\VolOrganization;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Who is told about an expense claim, and how (owner decisions, 2 and 6 October 2026):
 *
 *  - a new claim goes to the organisation's admins (creator + active owner/admin
 *    members), never to the claimant, a plain member or a closed account;
 *  - only when no organisation admin can be told does it fall back to the
 *    community's admins, pointing them at the admin screen;
 *  - the volunteer hears every decision by email AND in the app, and sees the
 *    reviewer's note whether the claim was approved or rejected.
 *
 * Emails are captured by swapping the mailer; sendRaw() resolves the container
 * binding, so these assertions prove a message was really handed over.
 */
class VolunteerExpenseNotificationTest extends TestCase
{
    use DatabaseTransactions;

    private ExpenseRecordingMailer $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);
        Cache::flush();

        $this->mailer = new ExpenseRecordingMailer();
        $this->app->instance(EmailDispatchService::class, $this->mailer);
    }

    private function user(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create($attrs + [
            'email' => 'exp-' . uniqid('', true) . '@example.test',
        ]);
    }

    private function org(User $owner): VolOrganization
    {
        return VolOrganization::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'approved',
        ]);
    }

    private function member(int $orgId, int $userId, string $role): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function submit(User $volunteer, int $orgId): void
    {
        Sanctum::actingAs($volunteer);
        $this->apiPost('/v2/volunteering/expenses', [
            'organization_id' => $orgId,
            'expense_type' => 'travel',
            'amount' => 8,
            'description' => 'Bus fare',
        ])->assertStatus(201);
    }

    private function claim(int $orgId, User $volunteer, string $status = 'pending'): VolExpense
    {
        return VolExpense::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'status' => $status,
            'amount' => 12.5,
            'submitted_at' => now(),
        ]);
    }

    /** @return list<string> */
    private function emailedTo(): array
    {
        return array_map(fn (array $c) => $c['to'], $this->mailer->calls);
    }

    /** @return list<int> */
    private function belledUsers(string $type): array
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('type', $type)
            ->pluck('user_id')->map(fn ($id) => (int) $id)->all();
    }

    // ── New claim: organisation admins ──────────────────────────────────

    public function test_new_claim_emails_each_organisation_admin_and_nobody_else(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $orgAdmin = $this->user();
        $this->member($org->id, $orgAdmin->id, 'admin');
        $plain = $this->user();
        $this->member($org->id, $plain->id, 'member');
        $communityAdmin = $this->user(['role' => 'admin']);
        $volunteer = $this->user();
        $this->member($org->id, $volunteer->id, 'member');

        $this->submit($volunteer, $org->id);

        $to = $this->emailedTo();
        sort($to);
        $expected = [$owner->email, $orgAdmin->email];
        sort($expected);
        $this->assertSame($expected, $to);
        $this->assertNotContains($communityAdmin->email, $to);
        foreach ($this->mailer->calls as $call) {
            $this->assertSame('volunteer_expense', $call['options']['category']);
            $this->assertStringContainsString("/volunteering/org/{$org->id}/dashboard?tab=expenses", $call['body']);
        }
    }

    public function test_new_claim_skips_a_suspended_organisation_admin(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $suspended = $this->user(['status' => 'suspended']);
        $this->member($org->id, $suspended->id, 'admin');
        $volunteer = $this->user();
        $this->member($org->id, $volunteer->id, 'member');

        $this->submit($volunteer, $org->id);

        $this->assertSame([$owner->email], $this->emailedTo());
        $this->assertNotContains((int) $suspended->id, $this->belledUsers('vol_expense_submitted'));
    }

    // ── New claim: fallback to community admins ─────────────────────────

    public function test_claim_by_the_only_organisation_admin_falls_back_to_community_admins(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $communityAdmin = $this->user(['role' => 'admin']);
        $flagAdmin = $this->user(['is_tenant_super_admin' => 1]);
        $broker = $this->user(['role' => 'broker']);
        $closedAdmin = $this->user(['role' => 'admin', 'status' => 'suspended']);

        $this->submit($owner, $org->id);

        $to = $this->emailedTo();
        $this->assertContains($communityAdmin->email, $to);
        $this->assertContains($flagAdmin->email, $to);
        $this->assertNotContains($owner->email, $to, 'The claimant is never told about their own claim.');
        $this->assertNotContains($broker->email, $to);
        $this->assertNotContains($closedAdmin->email, $to);

        $bells = $this->belledUsers('vol_expense_submitted');
        $this->assertContains((int) $communityAdmin->id, $bells);
        $this->assertNotContains((int) $owner->id, $bells);

        $call = $this->mailer->calls[array_search($communityAdmin->email, $to, true)];
        $this->assertStringContainsString('/admin/volunteering/expenses', $call['body']);
        $this->assertStringContainsString(
            htmlspecialchars(__('emails_misc.expense.new_claim_fallback_note', ['organisation' => $org->name]), ENT_QUOTES, 'UTF-8'),
            $call['body']
        );
    }

    public function test_falls_back_when_the_only_organisation_admin_is_suspended(): void
    {
        $owner = $this->user(['status' => 'suspended']);
        $org = $this->org($owner);
        $communityAdmin = $this->user(['role' => 'admin']);
        $volunteer = $this->user();
        $this->member($org->id, $volunteer->id, 'member');

        $this->submit($volunteer, $org->id);

        $to = $this->emailedTo();
        $this->assertContains($communityAdmin->email, $to);
        $this->assertNotContains($owner->email, $to);
    }

    public function test_community_admins_are_not_told_when_an_organisation_admin_is(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $communityAdmin = $this->user(['role' => 'admin']);
        $volunteer = $this->user();
        $this->member($org->id, $volunteer->id, 'member');

        $this->submit($volunteer, $org->id);

        $this->assertNotContains($communityAdmin->email, $this->emailedTo());
        $this->assertNotContains((int) $communityAdmin->id, $this->belledUsers('vol_expense_submitted'));
    }

    // ── Decisions: the volunteer ────────────────────────────────────────

    public function test_approval_emails_and_notifies_the_volunteer_with_the_reviewer_note(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $volunteer = $this->user();
        $expense = $this->claim($org->id, $volunteer);

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", [
            'status' => 'approved',
            'review_notes' => 'Thanks — paid with next run',
        ])->assertStatus(200);

        $this->assertSame([$volunteer->email], $this->emailedTo());
        $this->assertStringContainsString('Thanks — paid with next run', $this->mailer->calls[0]['body']);
        $this->assertSame([(int) $volunteer->id], $this->belledUsers('vol_expense_reviewed'));
    }

    public function test_rejection_emails_and_notifies_the_volunteer_with_the_reviewer_note(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $volunteer = $this->user();
        $expense = $this->claim($org->id, $volunteer);

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", [
            'status' => 'rejected',
            'review_notes' => 'No receipt attached',
        ])->assertStatus(200);

        $this->assertSame([$volunteer->email], $this->emailedTo());
        $this->assertStringContainsString('No receipt attached', $this->mailer->calls[0]['body']);
        $this->assertSame([(int) $volunteer->id], $this->belledUsers('vol_expense_reviewed'));
    }

    public function test_payment_emails_and_notifies_the_volunteer(): void
    {
        $owner = $this->user();
        $org = $this->org($owner);
        $volunteer = $this->user();
        $expense = $this->claim($org->id, $volunteer, 'approved');

        Sanctum::actingAs($owner);
        $this->apiPut("/v2/volunteering/organisations/{$org->id}/expenses/{$expense->id}", [
            'status' => 'paid',
            'payment_reference' => 'BANK-42',
        ])->assertStatus(200);

        $this->assertSame([$volunteer->email], $this->emailedTo());
        $this->assertStringContainsString('BANK-42', $this->mailer->calls[0]['body']);
        $this->assertSame([(int) $volunteer->id], $this->belledUsers('vol_expense_paid'));
    }
}

/**
 * Records dispatches instead of sending (same technique as
 * Tests\Laravel\Feature\Auth\RecordingEmailDispatchService).
 */
class ExpenseRecordingMailer extends EmailDispatchService
{
    /** @var list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
