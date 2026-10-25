<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\Safeguarding\SafeguardingChoicesEmail;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The emails members get about their own safeguarding choices: the summary
 * describes exactly the protections that are enforced, is not repeated when
 * nothing changed, and renders in the member's own language; the one-off
 * vetted-only notice reaches each holder once; the operator command sends
 * nothing on a dry run.
 */
final class SafeguardingChoicesEmailTest extends TestCase
{
    use DatabaseTransactions;

    private SafeguardingChoicesCapturingDispatch $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mailer = new SafeguardingChoicesCapturingDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(200);
    }

    public function test_the_summary_lists_only_the_protections_that_are_on(): void
    {
        $member = $this->memberHolding(['coordinator_introductions']);

        $this->assertSame('sent', app(SafeguardingChoicesEmail::class)->sendSummary($this->testTenantId, $member->id));

        $body = $this->mailer->lastFor($member->email)['body'];
        $this->assertStringContainsString(e(__('safeguarding.effects.broker_approval')), $body);
        $this->assertStringContainsString(e(__('safeguarding.effects.restricts_matching')), $body);
        $this->assertStringNotContainsString(e(__('safeguarding.effects.restricts_messaging')), $body);
        $this->assertStringNotContainsString('time credits', $body, 'No vetted-only paragraph when that block is off');
    }

    public function test_the_summary_is_not_repeated_when_nothing_changed_but_is_when_choices_change(): void
    {
        $member = $this->memberHolding(['no_home_visits']);
        $email = app(SafeguardingChoicesEmail::class);

        $this->assertSame('sent', $email->sendSummary($this->testTenantId, $member->id));
        $this->assertSame('unchanged', $email->sendSummary($this->testTenantId, $member->id));

        $this->hold($member, 'coordinator_introductions');
        $this->assertSame('sent', $email->sendSummary($this->testTenantId, $member->id));
        $this->assertCount(2, $this->mailer->sent);
    }

    public function test_a_member_who_only_declined_gets_no_summary(): void
    {
        $member = $this->memberHolding(['none_apply']);

        $this->assertSame('nothing_selected', app(SafeguardingChoicesEmail::class)->sendSummary($this->testTenantId, $member->id));
        $this->assertSame([], $this->mailer->sent);
    }

    public function test_the_summary_renders_in_the_members_language(): void
    {
        $member = $this->memberHolding(['coordinator_introductions'], ['preferred_language' => 'ga']);

        app(SafeguardingChoicesEmail::class)->sendSummary($this->testTenantId, $member->id);

        $irish = (string) __('emails_misc.safeguarding_choices.summary_title', [], 'ga');
        $this->assertNotSame((string) __('emails_misc.safeguarding_choices.summary_title', [], 'en'), $irish);
        $body = $this->mailer->lastFor($member->email)['body'];
        $this->assertStringContainsString(e($irish), $body);
        // The option's own label too, not only the email's wording: it was
        // first rendered in English because it was localised too early.
        $this->assertStringContainsString(
            e((string) __('safeguarding.presets.common.options.coordinator_introductions.label', [], 'ga')),
            $body,
        );
    }

    public function test_the_vetted_only_notice_reaches_each_holder_once_and_nobody_else(): void
    {
        $holder = $this->memberHolding(['requires_vetted_partners']);
        $other = $this->memberHolding(['coordinator_introductions']);
        $email = app(SafeguardingChoicesEmail::class);

        $this->assertSame('sent', $email->sendVettedOptionNotice($this->testTenantId, $holder->id));
        $this->assertSame('already_sent', $email->sendVettedOptionNotice($this->testTenantId, $holder->id));
        $this->assertSame('not_held', $email->sendVettedOptionNotice($this->testTenantId, $other->id));

        $body = $this->mailer->lastFor($holder->email)['body'];
        $this->assertStringContainsString('No members', $body, 'The holder must be told the true number of vetted members');
        $this->assertCount(1, $this->mailer->sent);
    }

    public function test_the_operator_command_sends_nothing_on_a_dry_run(): void
    {
        $this->memberHolding(['requires_vetted_partners']);
        $this->memberHolding(['no_home_visits']);

        $this->artisan('safeguarding:send-choice-summaries', ['--notice' => true, '--dry-run' => true, '--tenant' => $this->testTenantId])
            ->assertSuccessful();
        $this->artisan('safeguarding:send-choice-summaries', ['--dry-run' => true, '--tenant' => $this->testTenantId])
            ->assertSuccessful();

        $this->assertSame([], $this->mailer->sent);
        $this->assertSame(0, DB::table('safeguarding_member_emails')->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_the_summary_run_waits_until_a_vetted_only_holder_has_had_the_notice(): void
    {
        $holder = $this->memberHolding(['requires_vetted_partners']);

        $this->artisan('safeguarding:send-choice-summaries', ['--tenant' => $this->testTenantId])->assertSuccessful();
        $this->assertSame([], $this->mailer->sent, 'No summary before the notice');

        $this->artisan('safeguarding:send-choice-summaries', ['--notice' => true, '--tenant' => $this->testTenantId])->assertSuccessful();
        $this->artisan('safeguarding:send-choice-summaries', ['--tenant' => $this->testTenantId])->assertSuccessful();
        $this->assertCount(2, array_filter($this->mailer->sent, fn ($m) => $m['to'] === $holder->email));
    }

    public function test_the_health_check_alerts_when_members_need_vetting_nobody_has(): void
    {
        $this->memberHolding(['requires_vetted_partners']);

        $this->artisan('safeguarding:check-policy-health')
            ->expectsOutputToContain("Tenant {$this->testTenantId}: members require vetted contact but no vetting is recorded")
            ->assertFailed();
    }

    /** @param list<string> $keys @param array<string, mixed> $attributes */
    private function memberHolding(array $keys, array $attributes = []): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'email' => 'sg-' . bin2hex(random_bytes(5)) . '@example.org',
        ], $attributes));
        foreach ($keys as $key) {
            $this->hold($member, $key);
        }

        return $member;
    }

    private function hold(User $member, string $key): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => (int) TenantSafeguardingOption::withoutGlobalScopes()
                ->where('tenant_id', $this->testTenantId)
                ->where('option_key', $key)
                ->where('is_active', true)
                ->valueOrFail('id'),
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}

/** Records every email instead of sending it. */
class SafeguardingChoicesCapturingDispatch extends EmailDispatchService
{
    /** @var array<int, array{to:string, subject:string, body:string, options:array<string,mixed>}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body, 'options' => $options];

        return true;
    }

    /** @return array{to:string, subject:string, body:string, options:array<string,mixed>} */
    public function lastFor(string $to): array
    {
        $mine = array_values(array_filter($this->sent, fn ($m) => $m['to'] === $to));
        \PHPUnit\Framework\Assert::assertNotEmpty($mine, "no email was sent to {$to}");

        return end($mine);
    }
}
