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

    public function test_send_with_valid_context_type_succeeds_and_keeps_no_id(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $appr = $this->svc->send($sender, $receiver, 'Nice event help!', 'event_help', 42);

        $this->assertSame('event_help', $appr->context_type);
        // Only a completed exchange between the two people keeps its id.
        $this->assertNull($appr->context_id);
    }

    public function test_send_always_stores_a_private_note(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $appr = $this->svc->send($sender, $receiver, 'Private until the receiver says so');

        $this->assertFalse($appr->is_public);
        $this->assertSame(0, (int) DB::table('appreciations')->where('id', $appr->id)->value('is_public'));
    }

    public function test_send_throws_when_receiver_is_not_an_active_member(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        DB::table('users')->where('id', $receiver)->update(['status' => 'suspended']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('receiver_not_found');
        $this->svc->send($sender, $receiver, 'Hi');
    }

    public function test_send_refuses_an_exchange_context_that_is_not_theirs(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('invalid_context');
        $this->svc->send($sender, $receiver, 'Thanks', 'listing_completion', 2147480000);
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
            'is_public'      => true,
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
            'is_public'      => true,
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
            'is_public'      => true,
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
            'is_public'      => true,
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

    public function test_react_refuses_a_note_the_receiver_has_not_shown(): void
    {
        $appr = Appreciation::create([
            'sender_id' => $this->insertUser('s'), 'receiver_id' => $this->insertUser('r'),
            'tenant_id' => self::TENANT_ID, 'message' => 'Private', 'is_public' => false,
            'reactions_count' => 0,
        ]);

        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);
        $this->svc->react($appr->id, $this->insertUser('reactor'), 'heart');
    }

    // ── setVisibility() / delete() ────────────────────────────────────────────

    public function test_only_the_receiver_can_show_or_hide_a_note(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $appr = Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Show me', 'is_public' => false,
            'reactions_count' => 0,
        ]);

        $shown = $this->svc->setVisibility($appr->id, $receiver, true);
        $this->assertTrue($shown->is_public);
        $this->assertSame($sender, $shown->toArray()['sender']['id']);
        $this->assertSame($receiver, $shown->toArray()['receiver']['id']);
        $this->assertFalse($this->svc->setVisibility($appr->id, $receiver, false)->is_public);

        foreach ([$sender, $this->insertUser('other')] as $notTheReceiver) {
            try {
                $this->svc->setVisibility($appr->id, $notTheReceiver, true);
                $this->fail('Someone other than the receiver changed who can see a note.');
            } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
                $this->assertSame(0, (int) DB::table('appreciations')->where('id', $appr->id)->value('is_public'));
            }
        }
    }

    public function test_setVisibility_and_delete_ignore_a_note_of_another_tenant(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $appr = Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Mine', 'is_public' => false,
            'reactions_count' => 0,
        ]);

        TenantContext::setById(999);
        try {
            $this->assertFalse($this->svc->delete($appr->id, $receiver));
            try {
                $this->svc->setVisibility($appr->id, $receiver, true);
                $this->fail('A note was changed from another tenant.');
            } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
                // expected
            }
        } finally {
            TenantContext::setById(self::TENANT_ID);
        }

        $row = DB::table('appreciations')->where('id', $appr->id)->first();
        $this->assertNotNull($row);
        $this->assertSame(0, (int) $row->is_public);
    }

    public function test_the_receiver_or_the_sender_can_delete_and_nobody_else(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        $make = fn () => Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Delete me', 'is_public' => true,
            'reactions_count' => 1,
        ]);

        $first = $make();
        AppreciationReaction::create([
            'appreciation_id' => $first->id, 'user_id' => $sender,
            'tenant_id' => self::TENANT_ID, 'reaction_type' => 'heart', 'created_at' => now(),
        ]);
        $this->assertFalse($this->svc->delete($first->id, $this->insertUser('other')));
        $this->assertTrue(DB::table('appreciations')->where('id', $first->id)->exists());
        $this->assertTrue(DB::table('appreciation_reactions')->where('appreciation_id', $first->id)->exists());

        $this->assertTrue($this->svc->delete($first->id, $receiver));
        $this->assertFalse(DB::table('appreciations')->where('id', $first->id)->exists());
        $this->assertFalse(DB::table('appreciation_reactions')->where('appreciation_id', $first->id)->exists());

        $second = $make();
        $this->assertTrue($this->svc->delete($second->id, $sender));
        $this->assertFalse(DB::table('appreciations')->where('id', $second->id)->exists());
    }

    // ── lists ─────────────────────────────────────────────────────────────────

    public function test_sent_and_received_lists_name_both_people_by_first_name_only(): void
    {
        $sender   = $this->insertUser('s');
        $receiver = $this->insertUser('r');
        Appreciation::create([
            'sender_id' => $sender, 'receiver_id' => $receiver,
            'tenant_id' => self::TENANT_ID, 'message' => 'Names', 'is_public' => false,
            'reactions_count' => 0,
        ]);

        // Nobody is signed in here, so nobody may see a surname (E-122).
        foreach ([
            $this->svc->getSentAppreciations($sender),
            $this->svc->getReceivedAppreciations($receiver, 1, 20, false, $receiver),
            $this->svc->getMyAppreciations($sender),
        ] as $result) {
            $this->assertCount(1, $result['data']);
            $item = $result['data'][0]->toArray();
            $this->assertSame(['id' => $sender, 'name' => 'Appr', 'avatar_url' => null], $item['sender']);
            $this->assertSame(['id' => $receiver, 'name' => 'Appr', 'avatar_url' => null], $item['receiver']);
            $this->assertStringNotContainsString('User', json_encode($item['sender']) . json_encode($item['receiver']));
        }

        // A private note is in neither person's public wall.
        $this->assertSame([], $this->svc->getReceivedAppreciations($receiver)['data']);
        $this->assertSame([], $this->svc->getSentAppreciations($receiver)['data']);
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
}
