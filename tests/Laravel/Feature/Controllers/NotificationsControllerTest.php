<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for NotificationsController — list, mark read, delete.
 */
class NotificationsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  INDEX
    // ------------------------------------------------------------------

    public function test_index_returns_notifications(): void
    {
        $user = $this->authenticatedUser();
        Notification::factory()->forTenant($this->testTenantId)->count(3)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet('/v2/notifications');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/notifications');

        $response->assertStatus(401);
    }

    public function test_index_only_returns_own_notifications(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Notification::factory()->forTenant($this->testTenantId)->count(2)->create([
            'user_id' => $user->id,
        ]);
        Notification::factory()->forTenant($this->testTenantId)->count(3)->create([
            'user_id' => $other->id,
        ]);

        $response = $this->apiGet('/v2/notifications');

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertIsArray($data);
    }

    // ------------------------------------------------------------------
    //  COUNTS
    // ------------------------------------------------------------------

    public function test_counts_returns_data(): void
    {
        $user = $this->authenticatedUser();
        Notification::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'is_read' => false,
        ]);

        $response = $this->apiGet('/v2/notifications/counts');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_counts_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/notifications/counts');

        $response->assertStatus(401);
    }

    public function test_event_category_includes_namespaced_and_legacy_event_types(): void
    {
        $user = $this->authenticatedUser();

        foreach (['event_created', 'event_rsvp_confirm', 'new_event_created', 'message'] as $type) {
            Notification::factory()->forTenant($this->testTenantId)->create([
                'user_id' => $user->id,
                'type' => $type,
            ]);
        }

        $response = $this->apiGet('/v2/notifications?type=events');

        $response->assertOk();
        $this->assertEqualsCanonicalizing(
            ['event_created', 'event_rsvp_confirm', 'new_event_created'],
            collect($response->json('data'))->pluck('type')->all()
        );

        $counts = $this->apiGet('/v2/notifications/counts');
        $counts->assertOk()->assertJsonPath('data.events', 3);
    }

    public function test_index_rejects_an_unknown_notification_category(): void
    {
        $this->authenticatedUser();

        $this->apiGet('/v2/notifications?type=not-a-category')
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'INVALID_CATEGORY');
    }

    /**
     * 🔴 Notifications with no link are DISTINCT events and must not be collapsed.
     *
     * The grouping key was `type . ':' . (link ?? 'none')`, so every notification of one
     * type carrying no link — and most types carry none — collapsed into a single row.
     * The emulator fixture on 2026-09-06 showed one row reading "You earned the 'First
     * 5-Star' badge!" with a chip saying "18 notifications": eighteen different
     * achievements, seventeen of them hidden behind the newest, sharing nothing but a type.
     */
    public function test_notifications_without_a_link_are_not_grouped_together(): void
    {
        $user = $this->authenticatedUser();

        DB::table('notifications')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'type' => 'achievement',
                'title' => 'Achievement',
                'message' => "You earned the 'First 5-Star' badge!",
                'link' => null,
                'is_read' => false,
                'created_at' => now()->subMinute(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'type' => 'achievement',
                'title' => 'Achievement',
                'message' => "You earned the 'Ten Exchanges' badge!",
                'link' => null,
                'is_read' => false,
                'created_at' => now(),
            ],
        ]);

        $response = $this->apiGet('/v2/notifications/grouped');

        $response->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.is_grouped', false)
            ->assertJsonPath('data.1.is_grouped', false);
    }

    /**
     * 🔴 A group must carry the rows it is made of, or "expand" has nothing to show.
     *
     * Both clients offered an expand control for any grouped notification and rendered only
     * the actor avatars inside it — so a group whose notifications have no `actor_id`
     * expanded to nothing: the button flipped to "Collapse group" and not one pixel else
     * changed. Reported by the owner and reproduced on the emulator on 2026-09-06.
     */
    public function test_a_group_carries_its_own_notifications_so_it_can_be_expanded(): void
    {
        $user = $this->authenticatedUser();
        $link = '/wallet';

        for ($i = 0; $i < 3; $i++) {
            DB::table('notifications')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                // Deliberately NO actor_id: this is the case that used to expand to nothing.
                'type' => 'credits_received',
                'title' => 'Credits received',
                'message' => "You received {$i} credits.",
                'link' => $link,
                'is_read' => false,
                'created_at' => now()->subMinutes(3 - $i),
            ]);
        }

        $response = $this->apiGet('/v2/notifications/grouped');

        $response->assertOk()
            ->assertJsonPath('data.0.is_grouped', true)
            ->assertJsonPath('data.0.group_count', 3)
            ->assertJsonCount(3, 'data.0.group_items')
            // Newest first, matching the row the group collapses to.
            ->assertJsonPath('data.0.group_items.0.message', 'You received 2 credits.')
            // There are no actors at all here, which is exactly the case that broke.
            ->assertJsonCount(0, 'data.0.actors')
            ->assertJsonPath('data.0.remaining_count', 0);
    }

    /**
     * 🔴 Every notification carries the category its icon and colour come from.
     *
     * The server has always had this mapping — the unread counts and the category filter
     * both use it — but never attached it to a notification in the list payload. Mobile's
     * `Notification` type declares `category` as required and switches on it for the icon,
     * the tint and the label, so with the field absent every row rendered the same grey
     * bell and the label "Other".
     */
    public function test_every_notification_carries_the_category_its_icon_comes_from(): void
    {
        $user = $this->authenticatedUser();

        DB::table('notifications')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'type' => 'credits_received',
                'message' => 'You received 3 credits.',
                'link' => '/wallet',
                'is_read' => false,
                'created_at' => now()->subMinute(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'type' => 'new_message',
                'message' => 'You have a new message.',
                'link' => '/messages/1',
                'is_read' => false,
                'created_at' => now(),
            ],
        ]);

        $this->apiGet('/v2/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.category', 'messages')
            ->assertJsonPath('data.1.category', 'transactions');

        // And on the grouped endpoint, which builds its rows separately.
        $this->apiGet('/v2/notifications/grouped')
            ->assertOk()
            ->assertJsonPath('data.0.category', 'messages');
    }

    public function test_grouped_notifications_keep_the_latest_recipient_localized_message(): void
    {
        $user = $this->authenticatedUser(['preferred_language' => 'fr']);
        $firstActor = User::factory()->forTenant($this->testTenantId)->create();
        $secondActor = User::factory()->forTenant($this->testTenantId)->create();
        $link = '/events/42';

        DB::table('notifications')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'actor_id' => $firstActor->id,
                'type' => 'event_rsvp',
                'message' => 'Une personne participe à votre événement.',
                'link' => $link,
                'is_read' => false,
                'created_at' => now()->subMinute(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $user->id,
                'actor_id' => $secondActor->id,
                'type' => 'event_rsvp',
                'message' => 'Deux personnes participent à votre événement.',
                'link' => $link,
                'is_read' => true,
                'created_at' => now(),
            ],
        ]);

        $response = $this->apiGet('/v2/notifications/grouped');

        $response->assertOk()
            ->assertJsonPath('data.0.is_grouped', true)
            ->assertJsonPath('data.0.group_count', 2)
            ->assertJsonPath('data.0.all_read', false)
            ->assertJsonPath('data.0.is_read', false)
            ->assertJsonPath('data.0.read_at', null)
            ->assertJsonPath('data.0.message', 'Deux personnes participent à votre événement.')
            ->assertJsonPath('data.0.body', 'Deux personnes participent à votre événement.');
    }

    // ------------------------------------------------------------------
    //  MARK ALL READ
    // ------------------------------------------------------------------

    public function test_mark_all_read_succeeds(): void
    {
        $user = $this->authenticatedUser();
        Notification::factory()->forTenant($this->testTenantId)->count(3)->create([
            'user_id' => $user->id,
            'is_read' => false,
        ]);

        $response = $this->apiPost('/v2/notifications/read-all');

        $response->assertStatus(200);
        $response->assertJsonPath('data.marked_all_read', true);
    }

    public function test_mark_all_read_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/notifications/read-all');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  MARK SINGLE READ
    // ------------------------------------------------------------------

    public function test_mark_single_read_succeeds(): void
    {
        $user = $this->authenticatedUser();
        $notification = Notification::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'is_read' => false,
        ]);

        $response = $this->apiPost("/v2/notifications/{$notification->id}/read");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_mark_read_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/notifications/999999/read');

        $response->assertStatus(404);
    }

    public function test_mark_read_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/notifications/1/read');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  SHOW
    // ------------------------------------------------------------------

    public function test_show_returns_notification(): void
    {
        $user = $this->authenticatedUser();
        $notification = Notification::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet("/v2/notifications/{$notification->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/notifications/999999');

        $response->assertStatus(404);
    }

    public function test_show_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/notifications/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DESTROY (single)
    // ------------------------------------------------------------------

    public function test_destroy_notification_succeeds(): void
    {
        $user = $this->authenticatedUser();
        $notification = Notification::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiDelete("/v2/notifications/{$notification->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_destroy_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/notifications/999999');

        $response->assertStatus(404);
    }

    public function test_destroy_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/notifications/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DESTROY ALL
    // ------------------------------------------------------------------

    public function test_destroy_all_notifications_succeeds(): void
    {
        $user = $this->authenticatedUser();
        Notification::factory()->forTenant($this->testTenantId)->count(3)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiDelete('/v2/notifications');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['deleted']]);
    }

    public function test_destroy_all_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/notifications');

        $response->assertStatus(401);
    }

    public function test_destroy_all_events_deletes_every_event_type_and_nothing_else(): void
    {
        $user = $this->authenticatedUser();
        $notifications = [];

        foreach (['event_created', 'event_rsvp_confirm', 'new_event_created', 'message'] as $type) {
            $notifications[$type] = Notification::factory()->forTenant($this->testTenantId)->create([
                'user_id' => $user->id,
                'type' => $type,
            ]);
        }

        $response = $this->apiDelete('/v2/notifications?category=events');

        $response->assertOk()->assertJsonPath('data.deleted', 3);
        foreach (['event_created', 'event_rsvp_confirm', 'new_event_created'] as $type) {
            $this->assertSoftDeleted('notifications', ['id' => $notifications[$type]->id]);
        }
        $this->assertDatabaseHas('notifications', [
            'id' => $notifications['message']->id,
            'deleted_at' => null,
        ]);
    }

    public function test_destroy_all_rejects_an_unknown_category_without_deleting_rows(): void
    {
        $user = $this->authenticatedUser();
        $notification = Notification::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'type' => 'message',
        ]);

        $response = $this->apiDelete('/v2/notifications?category=not-a-category');

        $response->assertStatus(422)->assertJsonPath('errors.0.code', 'INVALID_CATEGORY');
        $this->assertDatabaseHas('notifications', [
            'id' => $notification->id,
            'deleted_at' => null,
        ]);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_read_other_tenant_notification(): void
    {
        $this->authenticatedUser();
        $otherNotification = Notification::factory()->forTenant(999)->create();

        $response = $this->apiGet("/v2/notifications/{$otherNotification->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_delete_other_tenant_notification(): void
    {
        $this->authenticatedUser();
        $otherNotification = Notification::factory()->forTenant(999)->create();

        $response = $this->apiDelete("/v2/notifications/{$otherNotification->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_mark_read_other_tenant_notification(): void
    {
        $this->authenticatedUser();
        $otherNotification = Notification::factory()->forTenant(999)->create();

        $response = $this->apiPost("/v2/notifications/{$otherNotification->id}/read");

        $response->assertStatus(404);
    }
}
