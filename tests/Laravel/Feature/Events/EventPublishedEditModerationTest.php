<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-590: when the community requires event moderation, an ordinary member
 * must not be able to change what members see on an event that has already
 * been approved. The publication state machine has no Published ->
 * PendingReview transition, so such edits are refused (409
 * EVENT_REVIEW_REQUIRED) rather than silently going live.
 */
final class EventPublishedEditModerationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_member_cannot_change_content_of_an_approved_event_when_moderation_is_required(): void
    {
        $this->setModerationRequired(true);
        $member = $this->member();
        $eventId = $this->publishedEventOwnedBy((int) $member->id);
        Sanctum::actingAs($member, ['*']);

        foreach ([
            ['title' => 'Unreviewed new title'],
            ['description' => 'Unreviewed new description'],
            ['location' => 'Somewhere unreviewed'],
        ] as $change) {
            $this->apiPut("/v2/events/{$eventId}", $change)
                ->assertStatus(409)
                ->assertJsonPath('errors.0.code', 'EVENT_REVIEW_REQUIRED');
        }

        $row = DB::table('events')->where('id', $eventId)->first(['title', 'description', 'location', 'publication_status']);
        self::assertSame('Approved title', $row->title);
        self::assertSame('Approved description', $row->description);
        self::assertSame('Approved venue', $row->location);
        self::assertSame('published', $row->publication_status);
    }

    public function test_member_cannot_replace_the_cover_image_of_an_approved_event_when_moderation_is_required(): void
    {
        $this->setModerationRequired(true);
        $member = $this->member();
        $eventId = $this->publishedEventOwnedBy((int) $member->id);
        Sanctum::actingAs($member, ['*']);

        $this->post(
            "/api/v2/events/{$eventId}/image",
            ['image' => UploadedFile::fake()->image('cover.jpg', 40, 40)],
            ['X-Tenant-ID' => (string) $this->testTenantId, 'Accept' => 'application/json'],
        )->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REVIEW_REQUIRED');

        self::assertNull(DB::table('events')->where('id', $eventId)->value('cover_image'));
    }

    public function test_non_content_changes_and_admin_edits_and_unmoderated_communities_still_work(): void
    {
        $this->setModerationRequired(true);
        $member = $this->member();
        $eventId = $this->publishedEventOwnedBy((int) $member->id);

        // A member may still change a non-content field (capacity).
        Sanctum::actingAs($member, ['*']);
        $this->apiPut("/v2/events/{$eventId}", ['max_attendees' => 25])->assertOk();
        self::assertSame(25, (int) DB::table('events')->where('id', $eventId)->value('max_attendees'));

        // A community admin bypasses moderation, as in the publication workflow.
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin, ['*']);
        $this->apiPut("/v2/events/{$eventId}", ['title' => 'Admin corrected title'])->assertOk();
        self::assertSame('Admin corrected title', DB::table('events')->where('id', $eventId)->value('title'));

        // Without moderation the member edits freely.
        $this->setModerationRequired(false);
        Sanctum::actingAs($member, ['*']);
        $this->apiPut("/v2/events/{$eventId}", ['title' => 'Member title, no moderation'])->assertOk();
        self::assertSame('Member title, no moderation', DB::table('events')->where('id', $eventId)->value('title'));
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function setModerationRequired(bool $required): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['events'] = array_merge(
            is_array($configuration['events'] ?? null) ? $configuration['events'] : [],
            ['moderation_required' => $required],
        );
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration, JSON_THROW_ON_ERROR),
        ]);
    }

    private function publishedEventOwnedBy(int $organizerId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Approved title',
            'description' => 'Approved description',
            'location' => 'Approved venue',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
            'timezone' => 'UTC',
            'max_attendees' => 10,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
