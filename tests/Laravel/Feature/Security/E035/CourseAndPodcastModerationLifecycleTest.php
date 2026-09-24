<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\PodcastShow;
use App\Models\User;
use App\Services\PodcastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-181 — a course's feed card ignored the course's lifecycle and audience: it
 *         stayed after unpublish, delete or rejection, and group-only courses
 *         were carded to the whole community.
 * F-182 — an admin's rejection was undone the moment the author republished,
 *         and edits to an approved course never went back to moderation.
 * F-183 — the prerequisites endpoint returned the title and slug of any course
 *         id the author typed in, including other members' drafts.
 */
class CourseAndPodcastModerationLifecycleTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $this->enableFeatures(['courses', 'feed', 'podcasts', 'groups']);
    }

    // ── F-181 ─────────────────────────────────────────────────────────

    public function test_unpublished_course_leaves_the_feed(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);
        $this->assertReaderFeedContains($reader, $course->title, true);

        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/unpublish")->assertStatus(200);

        $this->assertReaderFeedContains($reader, $course->title, false);
        $this->assertSame(0, $this->feedVisibility($course->id));
    }

    public function test_deleted_course_leaves_the_feed(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);

        $this->apiDelete("/v2/courses/{$course->id}")->assertStatus(200);

        $this->assertReaderFeedContains($reader, $course->title, false);
        $this->assertNull($this->feedVisibility($course->id));
    }

    public function test_admin_rejected_course_leaves_the_feed(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);

        $this->actAs($this->admin());
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'reject'])->assertStatus(200);

        $this->assertReaderFeedContains($reader, $course->title, false);
        $this->assertSame(0, $this->feedVisibility($course->id));
    }

    public function test_group_only_course_is_not_carded_to_the_whole_community(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'group');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);

        $this->assertReaderFeedContains($reader, $course->title, false);
        $this->assertNotSame(1, $this->feedVisibility($course->id));
    }

    public function test_stale_visible_card_for_a_draft_course_is_not_shown(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'source_type' => 'course',
            'source_id' => $course->id,
            'title' => $course->title,
            'content' => 'stale card',
            'is_visible' => 1,
            'created_at' => now(),
        ]);

        $this->assertReaderFeedContains($reader, $course->title, false);
    }

    // ── F-182 ─────────────────────────────────────────────────────────

    public function test_author_republish_does_not_undo_an_admin_rejection(): void
    {
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);
        $this->actAs($this->admin());
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'reject'])->assertStatus(200);

        $this->actAs($author);
        $republish = $this->apiPost("/v2/courses/{$course->id}/publish");
        $republish->assertStatus(200);

        $this->assertNotSame('approved', $republish->json('data.moderation_status'));
        $this->assertNotSame('approved', Course::find($course->id)->moderation_status);
        $this->assertReaderFeedContains($reader, $course->title, false);
    }

    public function test_author_republish_does_not_clear_an_admin_flag(): void
    {
        $author = $this->member();
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);
        $this->actAs($this->admin());
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'flag'])->assertStatus(200);

        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);

        $this->assertSame('flagged', Course::find($course->id)->moderation_status);
    }

    public function test_material_edit_of_an_approved_course_requeues_moderation_when_enabled(): void
    {
        $this->setTenantConfig(['courses' => ['moderation_enabled' => true]]);
        [$author, $reader] = [$this->member(), $this->member()];
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);
        $this->actAs($this->admin());
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'approve'])->assertStatus(200);
        $this->assertSame('approved', Course::find($course->id)->moderation_status);

        $this->actAs($author);
        $newTitle = 'Unreviewed replacement ' . uniqid();
        $this->apiPut("/v2/courses/{$course->id}", ['title' => $newTitle])->assertStatus(200);

        $this->assertSame('pending', Course::find($course->id)->moderation_status);
        $this->assertReaderFeedContains($reader, $newTitle, false);
    }

    public function test_lesson_changes_to_an_approved_course_requeue_moderation_when_enabled(): void
    {
        $this->setTenantConfig(['courses' => ['moderation_enabled' => true]]);
        $author = $this->member();
        $course = $this->draftCourse($author, 'public');
        $this->actAs($author);
        $this->apiPost("/v2/courses/{$course->id}/publish")->assertStatus(200);
        $admin = $this->admin();
        $this->actAs($admin);
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'approve'])->assertStatus(200);

        // Adding a lesson after approval puts the course back in the queue.
        $this->actAs($author);
        $created = $this->apiPost("/v2/courses/{$course->id}/lessons", [
            'title' => 'Added after approval',
            'content_type' => 'text',
            'body' => 'Reviewed text',
        ]);
        $created->assertStatus(201);
        $this->assertSame('pending', Course::find($course->id)->moderation_status);
        $lessonId = (int) ($created->json('data.id') ?? DB::table('course_lessons')->where('course_id', $course->id)->max('id'));

        // Editing a lesson's content after re-approval does too.
        $this->actAs($admin);
        $this->apiPost("/v2/admin/courses/{$course->id}/moderate", ['action' => 'approve'])->assertStatus(200);
        $this->actAs($author);
        $this->apiPut("/v2/courses/{$course->id}/lessons/{$lessonId}", ['body' => 'Unreviewed replacement text'])
            ->assertStatus(200);
        $this->assertSame('pending', Course::find($course->id)->moderation_status);
    }

    public function test_author_republish_does_not_undo_a_podcast_rejection(): void
    {
        $this->assertTrue(Schema::hasTable('podcast_shows'), 'podcast_shows must exist for this regression test');
        $author = $this->member();
        TenantContext::setById($this->testTenantId);
        $show = PodcastService::createShow($author->id, ['title' => 'F-182 show ' . uniqid(), 'visibility' => 'public']);
        $show = PodcastService::publishShow($show);
        $this->assertSame('approved', $show->moderation_status);

        $show = PodcastService::moderateShow($show, $this->admin()->id, 'reject', 'No');
        $show = PodcastService::publishShow(PodcastShow::find($show->id));

        $this->assertNotSame('approved', $show->moderation_status);
        $this->assertNotSame(1, (int) DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'podcast_show')
            ->where('source_id', $show->id)
            ->value('is_visible'));
    }

    // ── F-183 ─────────────────────────────────────────────────────────

    public function test_only_visible_courses_can_be_named_as_prerequisites(): void
    {
        [$author, $other] = [$this->member(), $this->member()];
        $othersDraft = $this->draftCourse($other, 'public', 'SECRET-DRAFT-TITLE-' . uniqid());
        $publicCourse = $this->publishedCourse($other, 'public');
        $ownDraft = $this->draftCourse($author, 'public');
        $course = $this->draftCourse($author, 'public');

        $this->actAs($author);
        $this->apiPut("/v2/courses/{$course->id}", [
            'prerequisites' => [$othersDraft->id, $publicCourse->id, $ownDraft->id],
        ])->assertStatus(200);

        $stored = Course::find($course->id)->prerequisites;
        $this->assertEqualsCanonicalizing([$publicCourse->id, $ownDraft->id], $stored);
    }

    public function test_prerequisites_endpoint_does_not_reveal_courses_the_viewer_cannot_see(): void
    {
        [$author, $other, $reader] = [$this->member(), $this->member(), $this->member()];
        $secretTitle = 'SECRET-DRAFT-TITLE-' . uniqid();
        $othersDraft = $this->draftCourse($other, 'public', $secretTitle);
        $publicCourse = $this->publishedCourse($other, 'public');
        $course = $this->publishedCourse($author, 'public');
        // A row written before the fix, bypassing the write-time check.
        DB::table('courses')->where('id', $course->id)->update([
            'prerequisites' => json_encode([$othersDraft->id, $publicCourse->id]),
        ]);

        $this->actAs($reader);
        $response = $this->apiGet("/v2/courses/{$course->id}/prerequisites");

        $response->assertStatus(200);
        $this->assertStringNotContainsString($secretTitle, (string) $response->getContent());
        $this->assertSame([$publicCourse->id], array_map('intval', array_column((array) $response->json('data'), 'id')));
    }

    // ------------------------------------------------------------------

    private function assertReaderFeedContains(User $reader, string $title, bool $expected): void
    {
        $this->actAs($reader);
        $feed = $this->apiGet('/v2/feed?per_page=100&personalised=false');
        $feed->assertStatus(200);
        $contains = str_contains((string) $feed->getContent(), $title);
        $this->assertSame($expected, $contains, $expected ? "Feed should show {$title}" : "Feed must not show {$title}");
    }

    private function feedVisibility(int $courseId): ?int
    {
        $value = DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'course')
            ->where('source_id', $courseId)
            ->value('is_visible');

        return $value === null ? null : (int) $value;
    }

    private function draftCourse(User $author, string $visibility, ?string $title = null): Course
    {
        TenantContext::setById($this->testTenantId);
        $course = new Course([
            'title' => $title ?? ('F-181 course ' . uniqid()),
            'slug' => 'e035-course-' . uniqid(),
            'summary' => 'E035 course summary',
            'visibility' => $visibility,
            'level' => 'beginner',
        ]);
        $course->tenant_id = $this->testTenantId;
        $course->author_user_id = $author->id;
        $course->status = 'draft';
        $course->moderation_status = 'pending';
        $course->save();

        return $course;
    }

    private function publishedCourse(User $author, string $visibility): Course
    {
        $course = $this->draftCourse($author, $visibility);
        $course->status = 'published';
        $course->moderation_status = 'approved';
        $course->published_at = now();
        $course->save();

        return $course;
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function admin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $admin;
    }

    /** @param array<string, mixed> $settings */
    private function setTenantConfig(array $settings): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['configuration']);
        $config = json_decode((string) ($row->configuration ?? '{}'), true) ?: [];
        $config = array_replace_recursive($config, $settings);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);
    }

    /** @param list<string> $features */
    private function enableFeatures(array $features): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        foreach ($features as $feature) {
            $current[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::setById($this->testTenantId);
    }
}
