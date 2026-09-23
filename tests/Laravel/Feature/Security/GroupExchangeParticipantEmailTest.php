<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-146 (found during the E-027 remediation): a group exchange's snapshot
 * returned every participant's email address (`user_email`) to the organiser
 * and to every other participant, on show and on every create/update/start
 * response. No client displays it and the settlement terms token does not use
 * it, so it is no longer selected or returned.
 */
final class GroupExchangeParticipantEmailTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        $this->mock(\App\Services\WebPushService::class, fn ($mock) => $mock->shouldReceive('sendToUser')->andReturn(true));
        Http::fake();
    }

    public function test_participants_never_see_each_others_email_addresses(): void
    {
        $organizer = $this->member();
        $provider = $this->member();
        $receiver = $this->member();

        Sanctum::actingAs($organizer, ['*']);
        $create = $this->apiPost('/v2/group-exchanges', [
            'title' => 'Barn raising',
            'total_hours' => 5,
            'split_type' => 'equal',
            'participants' => [
                ['user_id' => $provider->id, 'role' => 'provider'],
                ['user_id' => $receiver->id, 'role' => 'receiver'],
            ],
        ])->assertStatus(201);
        $this->assertNoEmails($create->getContent(), [$provider, $receiver]);
        $id = (int) $create->json('data.id');

        $start = $this->apiPost("/v2/group-exchanges/{$id}/start")->assertStatus(200);
        $this->assertNoEmails($start->getContent(), [$provider, $receiver]);

        Sanctum::actingAs($provider, ['*']);
        $show = $this->apiGet("/v2/group-exchanges/{$id}")->assertStatus(200);
        $this->assertNoEmails($show->getContent(), [$organizer, $receiver]);
        foreach ($show->json('data.participants') as $participant) {
            $this->assertArrayNotHasKey('user_email', $participant);
        }
    }

    /** @param list<User> $others */
    private function assertNoEmails(string $body, array $others): void
    {
        foreach ($others as $other) {
            $this->assertStringNotContainsString((string) $other->email, $body, 'Another member\'s email address was returned.');
        }
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 10,
            'email' => 'gx-' . bin2hex(random_bytes(5)) . '@example.test',
        ]);
    }
}
