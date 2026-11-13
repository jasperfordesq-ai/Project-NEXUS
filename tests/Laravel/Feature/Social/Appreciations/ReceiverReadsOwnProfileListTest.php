<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Appreciations;

use App\Core\TenantContext;
use App\Models\Social\Appreciation;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * SOC14 — the list a member's profile reads, when the member reading it is
 * the one the notes were written to.
 *
 * Since 12 Nov 2026 a thank-you note is private until its receiver shows it.
 * The phone app (every build up to 1.13.0) reads ONE list for a member's
 * notes — `GET /v2/users/{id}/appreciations` — whoever's profile it is. That
 * list held only shown notes, so a member who was thanked got a notification
 * and then found nothing in the app. The receiver is the one person a private
 * note is for; this list now gives them their own, flagged `is_public: false`.
 *
 * Everyone else — the sender, another member, staff — still gets only the
 * notes the receiver chose to show (ThankYouNoteRulesTest pins that).
 */
class ReceiverReadsOwnProfileListTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $features = array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['appreciations' => true]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_the_receiver_reads_their_private_notes_on_their_own_profile_list(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $private = $this->note($sender, $receiver, false, 'Only the receiver may read this');
        $shown = $this->note($sender, $receiver, true, 'Shown on the profile');
        $this->signInAs($receiver);

        $response = $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk();

        $response->assertJsonCount(2, 'data')->assertJsonPath('meta.total', 2);
        $byId = collect($response->json('data'))->keyBy('id');
        $this->assertFalse($byId[$private->id]['is_public'], 'a private note must say it is private');
        $this->assertTrue($byId[$shown->id]['is_public']);
        $this->assertSame('Only the receiver may read this', $byId[$private->id]['message']);
        $this->assertSame($sender->id, $byId[$private->id]['sender']['id']);
    }

    public function test_nobody_else_reads_the_receivers_private_notes_on_that_list(): void
    {
        $sender = $this->person();
        $receiver = $this->person();
        $this->note($sender, $receiver, false, 'Only the receiver may read this');
        $shown = $this->note($sender, $receiver, true, 'Shown on the profile');

        $viewers = [
            'another member' => $this->person(),
            'the sender' => $sender,
            'an administrator' => $this->person(['role' => 'admin']),
        ];
        foreach ($viewers as $who => $viewer) {
            $this->signInAs($viewer);
            $response = $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk();
            $response->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shown->id);
            $this->assertStringNotContainsString(
                'Only the receiver may read this',
                (string) $response->getContent(),
                "{$who} must not read a note its receiver has not shown",
            );
        }
    }

    public function test_the_receiver_does_not_read_a_note_written_to_them_in_another_community(): void
    {
        $receiver = $this->person();
        $sender = $this->person();
        // The same two account ids, but the note belongs to another community.
        DB::table('appreciations')->insert([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => 999,
            'message' => 'Written in another community',
            'is_public' => 0,
            'reactions_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->signInAs($receiver);

        $response = $this->apiGet("/v2/users/{$receiver->id}/appreciations")->assertOk();

        $response->assertJsonCount(0, 'data');
        $this->assertStringNotContainsString('Written in another community', (string) $response->getContent());
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'onboarding_completed' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function note(User $sender, User $receiver, bool $shown, string $message): Appreciation
    {
        return Appreciation::create([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'tenant_id' => $this->testTenantId,
            'message' => $message,
            'is_public' => $shown,
            'reactions_count' => 0,
        ]);
    }
}
