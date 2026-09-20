<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Social;

use App\Core\TenantContext;
use App\Models\Social\Appreciation;
use App\Models\Social\AppreciationReaction;
use App\Services\Social\AppreciationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * AppreciationServiceTest
 *
 * Strategy:
 *  - send(): guard validations (self-thank, message-too-long, bad context,
 *    rate-limit) require a real users row; happy path persists an
 *    appreciations row.  Notification side-effects are wrapped in try/catch
 *    so mail/push failures don't affect assertions.
 *  - react(): toggle on / toggle off / swap reactions; also tests invalid type.
 *  - getReceivedAppreciations(): confirms tenant scoping and public-only filter.
 *  - getMostAppreciatedMembers(): smoke-check it returns correct ranking data.
 *
 * Skipped: notifyReceiver mail dispatch (MAIL_MAILER=array in CI env; push is
 *   fire-and-forget caught by try/catch; tested in NotificationDispatcherTest).
 */
class AppreciationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private AppreciationService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        $this->svc = new AppreciationService();
        // Reset rate-limit cache so tests are independent.
        Cache::flush();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function insertUser(string $tag = ''): int
    {
        $uid = uniqid('appr_' . $tag . '_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'name'              => 'Appr User ' . $uid,
            'first_name'        => 'Appr',
            'last_name'         => 'User',
            'email'             => $uid . '@appr.test',
            'status'            => 'active',
            'balance'           => 0,
            'role'              => 'member',
            'is_approved'       => 1,
            'preferred_language'=> 'en',
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    // ── send(): guard conditions ──────────────────────────────────────────────

    public function test_send_throws_when_sender_equals_receiver(): void
    {
        $uid = $this->insertUser();
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('cannot_thank_self');
        $this->svc->send($uid, $uid, 'Hello');
    }

    public function test_send_throws_when_message_exceeds_500_chars(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('message_too_long');
        $this->svc->send($sender, $receiver, str_repeat('x', 501));
    }

    public function test_send_throws_for_invalid_context_type(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('invalid_context');
        $this->svc->send($sender, $receiver, 'Great work!', 'bad_context');
    }

    public function test_send_throws_when_sender_not_found(): void
    {
        $receiver = $this->insertUser('r');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('sender_not_found');
        $this->svc->send(9999998, $receiver, 'Hi');
    }

    public function test_send_throws_when_receiver_not_found(): void
    {
        $sender = $this->insertUser('s');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('receiver_not_found');
        $this->svc->send($sender, 9999997, 'Hi');
    }

    // ── send(): rate-limit ────────────────────────────────────────────────────

    public function test_send_throws_rate_limit_exceeded_after_10_appreciations(): void
    {
        $sender   = $this->insertUser('rl_s');
        $receiver = $this->insertUser('rl_r');

        // Pre-fill the cache key to DAILY_SEND_LIMIT
        $today   = now()->toDateString();
        $rateKey = "appreciation_sent:" . self::TENANT_ID . ":{$sender}:{$today}";
        Cache::put($rateKey, AppreciationService::DAILY_SEND_LIMIT, now()->endOfDay());

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('rate_limit_exceeded');
        $this->svc->send($sender, $receiver, 'Over limit');
    }

    // ── send(): happy path ────────────────────────────────────────────────────

    public function test_send_persists_appreciation_row(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $appr = $this->svc->send($sender, $receiver, 'Thank you so much!');

        $this->assertInstanceOf(Appreciation::class, $appr);
        $this->assertEquals($sender, $appr->sender_id);
        $this->assertEquals($receiver, $appr->receiver_id);
        $this->assertSame(self::TENANT_ID, (int) $appr->tenant_id);
        $this->assertSame('Thank you so much!', $appr->message);

        // Also exists in DB.
        $exists = DB::table('appreciations')
            ->where('id', $appr->id)
            ->where('tenant_id', self::TENANT_ID)
            ->exists();
        $this->assertTrue($exists);
    }

    public function test_send_with_valid_context_type_succeeds(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $appr = $this->svc->send($sender, $receiver, 'Nice event help!', 'event_help', 42);

        $this->assertSame('event_help', $appr->context_type);
        $this->assertEquals(42, (int) $appr->context_id);
    }

    public function test_send_increments_cache_counter_after_success(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $today    = now()->toDateString();
        $rateKey  = "appreciation_sent:" . self::TENANT_ID . ":{$sender}:{$today}";

        $before = (int) Cache::get($rateKey, 0);
        $this->svc->send($sender, $receiver, 'Well done!');
        $after = (int) Cache::get($rateKey, 0);

        $this->assertSame($before + 1, $after);
    }

    // ── react() ───────────────────────────────────────────────────────────────

    public function test_react_throws_for_invalid_reaction_type(): void
    {
        $appr = Appreciation::create([
            'sender_id'      => $this->insertUser('s'),
            'receiver_id'    => $this->insertUser('r'),
            'tenant_id'      => self::TENANT_ID,
            'message'        => 'Thanks',
            'reactions_count'=> 0,
        ]);
        $user = $this->insertUser('reactor');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('invalid_reaction');
        $this->svc->react($appr->id, $user, 'thumbs_up');
    }

    public function test_react_creates_reaction_and_increments_count(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $appr = Appreciation::create([
            'sender_id'      => $sender,
            'receiver_id'    => $receiver,
            'tenant_id'      => self::TENANT_ID,
            'message'        => 'Great job!',
            'reactions_count'=> 0,
        ]);
        $reactor = $this->insertUser('reactor');

        $result = $this->svc->react($appr->id, $reactor, 'heart');

        $this->assertTrue($result['reacted']);
        $this->assertSame('heart', $result['reaction_type']);

        $freshCount = (int) Appreciation::find($appr->id)->reactions_count;
        $this->assertSame(1, $freshCount);
    }

    public function test_react_toggles_off_same_reaction_type(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $appr = Appreciation::create([
            'sender_id'      => $sender,
            'receiver_id'    => $receiver,
            'tenant_id'      => self::TENANT_ID,
            'message'        => 'Brilliant!',
            'reactions_count'=> 0,
        ]);
        $reactor = $this->insertUser('reactor');

        // React once
        $this->svc->react($appr->id, $reactor, 'clap');
        // React again with same type → toggle off
        $result = $this->svc->react($appr->id, $reactor, 'clap');

        $this->assertFalse($result['reacted']);
        $this->assertNull($result['reaction_type']);

        $freshCount = (int) Appreciation::find($appr->id)->reactions_count;
        $this->assertSame(0, $freshCount);
    }

    public function test_react_swaps_to_new_reaction_type(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $appr = Appreciation::create([
            'sender_id'      => $sender,
            'receiver_id'    => $receiver,
            'tenant_id'      => self::TENANT_ID,
            'message'        => 'Amazing!',
            'reactions_count'=> 0,
        ]);
        $reactor = $this->insertUser('reactor');

        // Initial reaction
        $this->svc->react($appr->id, $reactor, 'heart');
        // Swap to different type
        $result = $this->svc->react($appr->id, $reactor, 'star');

        $this->assertTrue($result['reacted']);
        $this->assertSame('star', $result['reaction_type']);

        $row = AppreciationReaction::where('appreciation_id', $appr->id)
            ->where('user_id', $reactor)
            ->first();
        $this->assertSame('star', $row->reaction_type);
    }

    // ── getReceivedAppreciations() ────────────────────────────────────────────

    public function test_getReceivedAppreciations_returns_only_public_by_default(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Public one', 'is_public' => true,
            'reactions_count' => 0,
        ]);
        Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Private one', 'is_public' => false,
            'reactions_count' => 0,
        ]);

        $result = $this->svc->getReceivedAppreciations($receiver, 1, 50, true);

        $public = array_filter($result['data'], fn ($a) => $a->message === 'Private one');
        $this->assertEmpty($public, 'Private appreciation should not appear in public-only listing');

        $found = array_filter($result['data'], fn ($a) => $a->message === 'Public one');
        $this->assertNotEmpty($found, 'Public appreciation should appear');
    }

    public function test_received_appreciations_include_only_the_viewers_tenant_scoped_reaction(): void
    {
        $sender = $this->insertUser('viewer');
        $receiver = $this->insertUser('receiver');
        $note = Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Viewer reaction fixture',
            'is_public' => true, 'reactions_count' => 1,
        ]);
        AppreciationReaction::create([
            'appreciation_id' => $note->id, 'user_id' => $sender,
            'tenant_id' => self::TENANT_ID, 'reaction_type' => 'heart', 'created_at' => now(),
        ]);
        AppreciationReaction::create([
            'appreciation_id' => $note->id, 'user_id' => $receiver,
            'tenant_id' => 1, 'reaction_type' => 'star', 'created_at' => now(),
        ]);

        $own = $this->svc->getReceivedAppreciations($receiver, 1, 20, true, $sender);
        $this->assertSame('heart', $own['data'][0]->toArray()['my_reaction'] ?? null);
        $other = $this->svc->getReceivedAppreciations($receiver, 1, 20, true, $receiver);
        $this->assertArrayHasKey('my_reaction', $other['data'][0]->toArray());
        $this->assertNull($other['data'][0]->my_reaction);
        $guest = $this->svc->getReceivedAppreciations($receiver, 1, 20, true);
        $this->assertNull($guest['data'][0]->my_reaction);
    }

    // ── getMostAppreciatedMembers() ───────────────────────────────────────────

    public function test_getMostAppreciatedMembers_returns_ranked_results(): void
    {
        $sender = $this->insertUser('s');
        $top    = $this->insertUser('top');
        $low    = $this->insertUser('low');

        // top: 3 appreciations, low: 1
        for ($i = 0; $i < 3; $i++) {
            Appreciation::create([
                'sender_id' => $sender, 'receiver_id' => $top,
                'tenant_id' => self::TENANT_ID, 'message' => "Great $i",
                'is_public' => true, 'reactions_count' => 0,
            ]);
        }
        Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $low,
            'tenant_id' => self::TENANT_ID, 'message' => 'Nice',
            'is_public' => true, 'reactions_count' => 0,
        ]);

        $result = $this->svc->getMostAppreciatedMembers(self::TENANT_ID, 'all_time', 10);

        $this->assertIsArray($result);
        $userIds = array_column($result, 'user_id');
        $this->assertContains($top, $userIds);
        $this->assertContains($low, $userIds);

        // top should rank before low
        $topPos = array_search($top, $userIds, true);
        $lowPos = array_search($low, $userIds, true);
        $this->assertLessThan($lowPos, $topPos, 'Higher appreciation count should rank first');
    }
}
