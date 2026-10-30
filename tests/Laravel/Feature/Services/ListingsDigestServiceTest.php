<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Http\Controllers\Api\NotificationUnsubscribeController;
use App\Services\EmailDispatchService;
use App\Services\ListingsDigestService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The offers & requests round-up email (ListingsDigestService).
 *
 * Every assertion looks only at mail sent to the members this test creates:
 * the shared test tenant has other members, and they may be emailed too.
 */
class ListingsDigestServiceTest extends TestCase
{
    use DatabaseTransactions;

    private ListingsDigestService $digest;
    private object $mail;
    private CarbonImmutable $now;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->now = CarbonImmutable::parse('2026-11-02 10:00:00');
        $this->mail = new class extends EmailDispatchService {
            /** @var list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
            public array $calls = [];

            public function __construct()
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return true;
            }
        };
        $this->app->instance(EmailDispatchService::class, $this->mail);
        $this->digest = $this->app->make(ListingsDigestService::class);
        // Start from the platform default for this community.
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', ListingsDigestService::SETTING_KEY)->delete();
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    // ── helpers ─────────────────────────────────────────────────────

    /** @param array<string, mixed> $prefs */
    private function member(string $firstName, array $prefs = []): int
    {
        $email = 'ld.' . uniqid('', true) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'first_name' => $firstName,
            'last_name' => 'Tester',
            'email' => $email,
            'username' => 'ld_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'status' => 'active',
            'is_approved' => 1,
            'email_verified_at' => now(),
            'preferred_language' => 'en',
            'notification_preferences' => json_encode($prefs),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function listing(int $ownerId, string $type, string $title, CarbonImmutable $createdAt, array $extra = []): int
    {
        return (int) DB::table('listings')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => $title,
            'description' => 'Round-up test listing ' . $title,
            'type' => $type,
            'status' => 'active',
            'created_at' => $createdAt->toDateTimeString(),
            'updated_at' => $createdAt->toDateTimeString(),
        ], $extra));
    }

    /** @return list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    private function mailTo(int $userId): array
    {
        $email = (string) DB::table('users')->where('id', $userId)->value('email');

        return array_values(array_filter($this->mail->calls, static fn (array $c): bool => $c['to'] === $email));
    }

    // ── tests ───────────────────────────────────────────────────────

    public function test_member_gets_new_listings_but_never_their_own(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        $this->listing($poster, 'offer', 'RoundUp sourdough lessons', $this->now->subDays(3));
        $this->listing($reader, 'request', 'RoundUp my own request', $this->now->subDays(2));

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $mail = $this->mailTo($reader);
        $this->assertCount(1, $mail);
        $this->assertStringContainsString('RoundUp sourdough lessons', $mail[0]['body']);
        $this->assertStringNotContainsString('RoundUp my own request', $mail[0]['body']);
        $this->assertSame('listings_digest', $mail[0]['options']['category']);
        $this->assertStringContainsString('/api/v2/notifications/unsubscribe?token=', (string) $mail[0]['options']['unsubscribeUrl']);
        // First name only — never a surname — for the person who posted.
        $this->assertStringContainsString('Mary', $mail[0]['body']);
        $this->assertStringNotContainsString('Mary Tester', $mail[0]['body']);
    }

    public function test_admin_from_another_community_can_preview_this_communitys_email(): void
    {
        // A global super admin's home is the master community, not this one.
        $poster = $this->member('Mary');
        $this->listing($poster, 'offer', 'RoundUp visiting preview offer', $this->now->subDays(2));
        $visitor = $this->member('Visiting');
        DB::table('users')->where('id', $visitor)->update(['tenant_id' => 1]);

        $html = $this->digest->preview($this->testTenantId, $visitor, 'all', $this->now);

        $this->assertNotNull($html);
        $this->assertStringContainsString('RoundUp visiting preview offer', $html);
        $this->assertStringContainsString('Visiting', $html);
        // Previewing records nothing, for the visitor or anyone else.
        $this->assertSame(0, DB::table('listings_digest_sends')->where('user_id', $visitor)->count());
    }

    public function test_preview_for_an_unknown_account_returns_nothing(): void
    {
        $this->assertNull($this->digest->preview($this->testTenantId, 2_000_000_000, 'all', $this->now));
    }

    public function test_never_repeats_a_listing_and_sends_nothing_when_nothing_is_new(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        $this->listing($poster, 'offer', 'RoundUp first offer', $this->now->subDays(3));

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);
        $this->assertCount(1, $this->mailTo($reader));

        // Not due again the next day.
        $this->digest->sendDueForTenant($this->testTenantId, $this->now->addDay());
        $this->assertCount(1, $this->mailTo($reader));

        // Due a month later, but nothing new: no email.
        $later = $this->now->addDays(31);
        $this->digest->sendDueForTenant($this->testTenantId, $later);
        $this->assertCount(1, $this->mailTo($reader));

        // Something new appears: only the new listing is sent.
        $this->listing($poster, 'request', 'RoundUp second request', $later->subDay());
        $this->digest->sendDueForTenant($this->testTenantId, $later);
        $mail = $this->mailTo($reader);
        $this->assertCount(2, $mail);
        $this->assertStringContainsString('RoundUp second request', $mail[1]['body']);
        $this->assertStringNotContainsString('RoundUp first offer', $mail[1]['body']);
    }

    public function test_weekly_member_is_due_before_a_monthly_one(): void
    {
        $poster = $this->member('Mary');
        $weekly = $this->member('Wendy', [ListingsDigestService::PREF_FREQUENCY => 'weekly']);
        $monthly = $this->member('Molly');
        $this->listing($poster, 'offer', 'RoundUp week one', $this->now->subDay());
        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $nextWeek = $this->now->addDays(7);
        $this->listing($poster, 'offer', 'RoundUp week two', $nextWeek->subDay());
        $this->digest->sendDueForTenant($this->testTenantId, $nextWeek);

        $this->assertCount(2, $this->mailTo($weekly));
        $this->assertCount(1, $this->mailTo($monthly));
    }

    public function test_members_who_switched_it_off_get_nothing(): void
    {
        $poster = $this->member('Mary');
        $off = $this->member('Olive', [ListingsDigestService::PREF_ENABLED => false]);
        $this->listing($poster, 'offer', 'RoundUp offer', $this->now->subDay());

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);
        $this->digest->sendAllBatch($this->testTenantId, 0, 100000, $this->now);

        $this->assertCount(0, $this->mailTo($off));
    }

    public function test_community_off_sends_nothing_automatically_but_members_can_opt_in(): void
    {
        $this->digest->setCommunityDefault($this->testTenantId, 'off');
        $poster = $this->member('Mary');
        $byDefault = $this->member('Dora');
        $optedIn = $this->member('Ida', [ListingsDigestService::PREF_FREQUENCY => 'monthly']);
        $this->listing($poster, 'offer', 'RoundUp offer', $this->now->subDay());

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $this->assertCount(0, $this->mailTo($byDefault));
        $this->assertCount(1, $this->mailTo($optedIn));
    }

    public function test_listings_from_a_blocked_member_are_left_out(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        $this->listing($poster, 'offer', 'RoundUp from someone blocked', $this->now->subDay());
        $other = $this->member('Nora');
        $this->listing($other, 'offer', 'RoundUp from someone else', $this->now->subDay());
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $reader,
            'blocked_user_id' => $poster,
            'created_at' => now(),
        ]);

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $mail = $this->mailTo($reader);
        $this->assertCount(1, $mail);
        $this->assertStringNotContainsString('RoundUp from someone blocked', $mail[0]['body']);
        $this->assertStringContainsString('RoundUp from someone else', $mail[0]['body']);
    }

    public function test_hidden_listings_are_never_sent(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        $this->listing($poster, 'offer', 'RoundUp visible offer', $this->now->subDay());
        $this->listing($poster, 'offer', 'RoundUp awaiting review', $this->now->subDay(), ['moderation_status' => 'pending_review']);
        $this->listing($poster, 'offer', 'RoundUp expired', $this->now->subDay(), ['expires_at' => $this->now->subHour()->toDateTimeString()]);
        $this->listing($poster, 'offer', 'RoundUp paused', $this->now->subDay(), ['status' => 'paused']);

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $body = $this->mailTo($reader)[0]['body'];
        $this->assertStringContainsString('RoundUp visible offer', $body);
        $this->assertStringNotContainsString('RoundUp awaiting review', $body);
        $this->assertStringNotContainsString('RoundUp expired', $body);
        $this->assertStringNotContainsString('RoundUp paused', $body);
    }

    public function test_admin_send_includes_older_listings_and_resets_the_member_clock(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        $this->listing($poster, 'offer', 'RoundUp old but still open', $this->now->subDays(200));

        $result = $this->digest->sendAllBatch($this->testTenantId, 0, 100000, $this->now);
        $this->assertTrue($result['done']);

        $mail = $this->mailTo($reader);
        $this->assertCount(1, $mail);
        $this->assertStringContainsString('RoundUp old but still open', $mail[0]['body']);

        // The automatic round-up the next day does not follow straight after.
        $this->listing($poster, 'offer', 'RoundUp brand new', $this->now);
        $this->digest->sendDueForTenant($this->testTenantId, $this->now->addDay());
        $this->assertCount(1, $this->mailTo($reader));
    }

    public function test_admin_send_walks_members_in_batches(): void
    {
        $poster = $this->member('Mary');
        $a = $this->member('Anna');
        $b = $this->member('Beth');
        $this->listing($poster, 'offer', 'RoundUp batch offer', $this->now->subDay());

        $first = $this->digest->sendAllBatch($this->testTenantId, $a - 1, 1, $this->now);
        $this->assertFalse($first['done']);
        $this->assertSame($a, $first['last_user_id']);
        $this->assertCount(1, $this->mailTo($a));
        $this->assertCount(0, $this->mailTo($b));

        $this->digest->sendAllBatch($this->testTenantId, $first['last_user_id'], 1, $this->now);
        $this->assertCount(1, $this->mailTo($b));
    }

    public function test_member_frequency_choice_overrides_the_community_default(): void
    {
        $member = $this->member('Sarah');
        $this->digest->setCommunityDefault($this->testTenantId, 'weekly');

        $this->assertSame(
            ['frequency' => 'default', 'community_default' => 'weekly', 'effective' => 'weekly'],
            $this->digest->memberSettings($member, $this->testTenantId),
        );
        $this->assertSame('monthly', $this->digest->setMemberFrequency($member, $this->testTenantId, 'monthly')['effective']);
        $this->assertSame('off', $this->digest->setMemberFrequency($member, $this->testTenantId, 'off')['effective']);
        $back = $this->digest->setMemberFrequency($member, $this->testTenantId, 'default');
        $this->assertSame(['frequency' => 'default', 'community_default' => 'weekly', 'effective' => 'weekly'], $back);
    }

    public function test_unsubscribe_link_switches_the_round_up_off(): void
    {
        $member = $this->member('Sarah', ['email_messages' => 1]);
        $url = NotificationUnsubscribeController::buildSignedUrl($member, $this->testTenantId, ListingsDigestService::UNSUBSCRIBE_CATEGORY);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $token = (string) $query['token'];

        $this->post('/api/v2/notifications/unsubscribe?token=' . rawurlencode($token), [
            'token' => $token,
            'confirm' => '1',
        ], $this->withTenantHeader())->assertStatus(200);

        $this->assertSame('off', $this->digest->memberSettings($member, $this->testTenantId)['effective']);
        $prefs = json_decode((string) DB::table('users')->where('id', $member)->value('notification_preferences'), true);
        $this->assertTrue((bool) $prefs['email_messages'], 'only the round-up is switched off');
    }

    public function test_newsletter_recent_listings_token_becomes_listing_cards(): void
    {
        $poster = $this->member('Mary');
        $this->listing($poster, 'offer', 'RoundUp newsletter offer', CarbonImmutable::now()->subMinute());

        $html = \App\Services\NewsletterService::renderEmail(
            ['subject' => 'News', 'content' => '<p>Hello</p>{{recent_listings}}', 'content_format' => 'richtext'],
            'Test community',
        );

        $this->assertStringNotContainsString('{{recent_listings}}', $html);
        $this->assertStringContainsString('RoundUp newsletter offer', $html);
    }

    public function test_email_is_written_in_the_members_language(): void
    {
        $poster = $this->member('Mary');
        $reader = $this->member('Sarah');
        // Irish: the test environment loads only English and Irish catalogues.
        DB::table('users')->where('id', $reader)->update(['preferred_language' => 'ga']);
        $this->listing($poster, 'offer', 'RoundUp offer', $this->now->subDay());

        $this->digest->sendDueForTenant($this->testTenantId, $this->now);

        $mail = $this->mailTo($reader)[0];
        $this->assertStringContainsString('Dia duit Sarah', $mail['body']);
        $this->assertStringContainsString('bhealach', $mail['subject']);
        $this->assertStringContainsString('lang="ga"', $mail['body']);
    }
}
