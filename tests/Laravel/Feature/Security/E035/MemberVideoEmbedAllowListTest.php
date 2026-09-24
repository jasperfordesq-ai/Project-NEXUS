<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Events\JobVacancyCreated;
use App\Models\Course;
use App\Models\CourseLesson;
use App\Models\JobVacancy;
use App\Models\User;
use App\Services\CourseLessonService;
use App\Services\JobVacancyService;
use App\Support\VideoEmbedUrl;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Illuminate\Validation\ValidationException;
use Tests\Laravel\TestCase;

/**
 * E-035 F-195 — member-supplied embed URLs (a job's employer video, a course
 * "embed" lesson) are framed inside platform pages. Only a recognised video
 * provider (YouTube, Vimeo) may be saved; anything else — notably a
 * Google-hosted form the page's content-security-policy would allow — is refused.
 */
class MemberVideoEmbedAllowListTest extends TestCase
{
    use DatabaseTransactions;

    private const PHISHING_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSf-fake/viewform?embedded=true';

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Event::fake([JobVacancyCreated::class]);
        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_only_youtube_and_vimeo_links_are_recognised(): void
    {
        $this->assertSame(['provider' => 'youtube', 'id' => 'dQw4w9WgXcQ'], VideoEmbedUrl::parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'));
        $this->assertSame(['provider' => 'youtube', 'id' => 'dQw4w9WgXcQ'], VideoEmbedUrl::parse('https://youtu.be/dQw4w9WgXcQ'));
        $this->assertSame(['provider' => 'youtube', 'id' => 'dQw4w9WgXcQ'], VideoEmbedUrl::parse('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
        $this->assertSame(['provider' => 'youtube', 'id' => 'dQw4w9WgXcQ'], VideoEmbedUrl::parse('https://youtube.com/shorts/dQw4w9WgXcQ'));
        $this->assertSame(['provider' => 'vimeo', 'id' => '76979871'], VideoEmbedUrl::parse('https://vimeo.com/76979871'));
        $this->assertSame(['provider' => 'vimeo', 'id' => '76979871'], VideoEmbedUrl::parse('https://player.vimeo.com/video/76979871'));

        foreach ([
            self::PHISHING_FORM,
            'https://sites.google.com/view/fake-login',
            'https://evil.example/watch?v=dQw4w9WgXcQ',
            'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
            'https://evil.example/?next=youtube.com/embed/dQw4w9WgXcQ',
            'https://user@www.youtube.com/watch?v=dQw4w9WgXcQ',
            'javascript:alert(1)//youtube.com/embed/dQw4w9WgXcQ',
            'https://www.youtube.com/watch?v=short',
            'https://vimeo.com/channels/staffpicks',
        ] as $url) {
            $this->assertNull(VideoEmbedUrl::parse($url), $url);
        }
    }

    public function test_job_create_refuses_a_non_video_embed_url(): void
    {
        $service = app(JobVacancyService::class);
        $id = $service->create($this->member->id, $this->jobPayload(['video_url' => self::PHISHING_FORM]));

        $this->assertSame(0, $id);
        $this->assertSame('video_url', $service->getErrors()[0]['field'] ?? null);
        $this->assertFalse(JobVacancy::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $this->member->id)
            ->exists());
    }

    public function test_job_create_and_update_accept_a_youtube_link_and_update_refuses_a_form(): void
    {
        $service = app(JobVacancyService::class);
        $id = $service->create($this->member->id, $this->jobPayload(['video_url' => 'https://youtu.be/dQw4w9WgXcQ']));
        $this->assertGreaterThan(0, $id, json_encode($service->getErrors()));
        $this->assertSame('https://youtu.be/dQw4w9WgXcQ', JobVacancy::withoutGlobalScopes()->find($id)?->video_url);

        $this->assertFalse($service->update($id, $this->member->id, ['video_url' => self::PHISHING_FORM]));
        $this->assertSame('video_url', $service->getErrors()[0]['field'] ?? null);
        $this->assertSame('https://youtu.be/dQw4w9WgXcQ', JobVacancy::withoutGlobalScopes()->find($id)?->video_url);

        // Clearing the video stays possible.
        $this->assertTrue($service->update($id, $this->member->id, ['video_url' => '']));
        $this->assertNull(JobVacancy::withoutGlobalScopes()->find($id)?->video_url);
    }

    public function test_course_embed_lesson_refuses_a_non_video_url(): void
    {
        $course = $this->course();

        try {
            CourseLessonService::create($course->id, [
                'title' => 'Embedded form',
                'content_type' => 'embed',
                'embed_url' => self::PHISHING_FORM,
            ]);
            $this->fail('A Google Forms embed was accepted.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('embed_url', $e->errors());
        }
        $this->assertSame(0, CourseLesson::where('course_id', $course->id)->count());

        $lesson = CourseLessonService::create($course->id, [
            'title' => 'Embedded video',
            'content_type' => 'embed',
            'embed_url' => 'https://player.vimeo.com/video/76979871',
        ]);
        $this->assertSame('https://player.vimeo.com/video/76979871', $lesson->embed_url);

        $this->expectException(ValidationException::class);
        CourseLessonService::update($lesson->id, ['embed_url' => 'https://sites.google.com/view/fake-login']);
    }

    /** @param array<string, mixed> $overrides */
    private function jobPayload(array $overrides): array
    {
        return array_merge([
            'title' => 'E035 video job ' . uniqid(),
            'description' => 'A volunteer role used by the embed allow-list test.',
            'type' => 'volunteer',
            'commitment' => 'flexible',
            'status' => 'draft',
        ], $overrides);
    }

    private function course(): Course
    {
        $course = new Course([
            'title' => 'E035 course ' . uniqid(),
            'slug' => 'e035-course-' . uniqid(),
            'visibility' => 'public',
            'level' => 'beginner',
        ]);
        $course->tenant_id = $this->testTenantId;
        $course->author_user_id = $this->member->id;
        $course->status = 'draft';
        $course->save();

        return $course;
    }
}
