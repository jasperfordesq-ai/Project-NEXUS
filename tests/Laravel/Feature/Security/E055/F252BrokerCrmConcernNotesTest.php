<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-252 (E-055 C-4): CRM "concern" notes are staff notes about a person's
 * conduct. A caller below admin tier (broker / coordinator) must not read a
 * concern note whose subject is themselves or an account at or above their
 * own tier (AdminTier::outranks — the rank rule F-219 uses for balance
 * changes). Hidden notes are filtered silently and do not count towards the
 * list total. Admins see everything; other note categories are unchanged.
 */
class F252BrokerCrmConcernNotesTest extends TestCase
{
    use DatabaseTransactions;

    private string $prefix;

    private User $admin;
    private User $broker;
    private User $otherBroker;
    private User $member;

    protected function setUp(): void
    {
        parent::setUp();

        $this->prefix = 'F252x' . bin2hex(random_bytes(4));

        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $this->broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $this->otherBroker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $this->member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
    }

    private function note(User $subject, string $category, string $label): string
    {
        $content = $this->prefix . '-' . $label;
        DB::insert(
            'INSERT INTO member_notes (tenant_id, user_id, author_id, content, category, is_pinned) VALUES (?, ?, ?, ?, ?, 0)',
            [$this->testTenantId, $subject->id, $this->admin->id, $content, $category]
        );

        return $content;
    }

    /** @return array{0: list<string>, 1: int} */
    private function listAs(User $caller, string $query = ''): array
    {
        Sanctum::actingAs($caller);
        $response = $this->apiGet('/v2/admin/crm/notes?limit=100&search=' . $this->prefix . $query);
        $response->assertStatus(200);

        $contents = array_map(
            static fn (array $row): string => (string) $row['content'],
            $response->json('data') ?? []
        );

        return [$contents, (int) $response->json('meta.total')];
    }

    private function seedConcernNotes(): array
    {
        return [
            'self' => $this->note($this->broker, 'concern', 'concern-self'),
            'broker' => $this->note($this->otherBroker, 'concern', 'concern-broker'),
            'admin' => $this->note($this->admin, 'concern', 'concern-admin'),
            'member' => $this->note($this->member, 'concern', 'concern-member'),
        ];
    }

    public function test_broker_does_not_receive_concern_notes_about_self_peers_or_admins(): void
    {
        $notes = $this->seedConcernNotes();

        [$contents, $total] = $this->listAs($this->broker);

        $this->assertNotContains($notes['self'], $contents, 'broker read a concern note about themselves');
        $this->assertNotContains($notes['broker'], $contents, 'broker read a concern note about another broker');
        $this->assertNotContains($notes['admin'], $contents, 'broker read a concern note about an admin');
        // Control: a broker still reads concern notes about ordinary members.
        $this->assertContains($notes['member'], $contents);
        // Hidden notes do not leak through the count either.
        $this->assertSame(1, $total);
    }

    public function test_broker_filtering_by_subject_and_category_still_hides_the_note(): void
    {
        $notes = $this->seedConcernNotes();

        foreach (['self' => $this->broker, 'broker' => $this->otherBroker, 'admin' => $this->admin] as $key => $subject) {
            [$contents, $total] = $this->listAs($this->broker, '&category=concern&user_id=' . $subject->id);
            $this->assertNotContains($notes[$key], $contents, "concern note about {$key} returned to broker via user_id filter");
            $this->assertSame(0, $total);
        }

        [$contents] = $this->listAs($this->broker, '&category=concern&user_id=' . $this->member->id);
        $this->assertContains($notes['member'], $contents);
    }

    public function test_admin_receives_every_concern_note(): void
    {
        $notes = $this->seedConcernNotes();

        [$contents, $total] = $this->listAs($this->admin);

        foreach ($notes as $content) {
            $this->assertContains($content, $contents);
        }
        $this->assertSame(4, $total);
    }

    public function test_non_concern_notes_are_unchanged_for_brokers(): void
    {
        $general = $this->note($this->admin, 'general', 'general-admin');
        $support = $this->note($this->broker, 'support', 'support-self');

        [$contents] = $this->listAs($this->broker);

        // Out of scope for F-252 (owner decision covers "concern" only).
        $this->assertContains($general, $contents);
        $this->assertContains($support, $contents);
    }
}
