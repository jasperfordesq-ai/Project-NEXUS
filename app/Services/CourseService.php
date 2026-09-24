<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseEnrollment;
use App\Models\CourseLesson;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * CourseService — tenant-scoped course CRUD, listing, and search.
 * Tenant scoping is enforced automatically by the HasTenantScope trait on the
 * Course model; this service layers visibility/status filtering on top.
 */
class CourseService
{
    private const LEVELS = ['beginner', 'intermediate', 'advanced'];
    private const VISIBILITIES = ['public', 'members', 'group'];
    private const ENROLLMENT_TYPES = ['self_paced', 'cohort'];

    /**
     * Browse published courses with optional filters and offset pagination.
     *
     * @param array{search?:string,category_id?:int,level?:string,page?:int,per_page?:int,include_member_only?:bool} $filters
     * @return array{items:array,total:int,page:int,per_page:int}
     */
    public static function browse(array $filters = []): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $perPage = min(50, max(1, (int) ($filters['per_page'] ?? 12)));

        $query = Course::query()
            ->published()
            ->with(['category:id,name,slug', 'author:id,name,avatar_url']);

        // Members-only courses are visible in the catalogue to logged-in members;
        // public-only browsing (e.g. anonymous) restricts to visibility=public.
        if (empty($filters['include_member_only'])) {
            $query->where('visibility', 'public');
        } else {
            $query->whereIn('visibility', ['public', 'members']);
        }

        if (!empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        if (!empty($filters['level'])) {
            $query->where('level', $filters['level']);
        }

        if (!empty($filters['search'])) {
            $term = trim((string) $filters['search']);
            $query->where(function ($q) use ($term) {
                $q->where('title', 'like', "%{$term}%")
                  ->orWhere('summary', 'like', "%{$term}%");
            });
        }

        $total = (clone $query)->count();

        $items = $query->orderByDesc('published_at')
            ->orderByDesc('id')
            ->forPage($page, $perPage)
            ->get()
            ->toArray();

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * Courses authored by a given user (any status) — for the instructor dashboard.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function authoredBy(int $userId): array
    {
        return Course::where('author_user_id', $userId)
            ->with('category:id,name,slug')
            ->orderByDesc('updated_at')
            ->get()
            ->toArray();
    }

    public static function findById(int $id): ?Course
    {
        return Course::with(['category', 'author:id,name,avatar_url', 'sections.lessons.quiz', 'unassignedLessons.quiz'])->find($id);
    }

    public static function findBySlug(string $slug): ?Course
    {
        return Course::where('slug', $slug)
            ->with(['category', 'author:id,name,avatar_url', 'sections.lessons.quiz', 'unassignedLessons.quiz'])
            ->first();
    }

    /**
     * Serialize course detail for the current viewer without turning the public
     * syllabus response into a lesson-content endpoint.
     *
     * Free previews and course managers may read complete lessons. Enrolled
     * learners may read only lessons whose drip schedule is currently open.
     * Everyone else receives the stable syllabus fields needed by the clients.
     *
     * @return array<string,mixed>
     */
    public static function detailForViewer(
        Course $course,
        ?CourseEnrollment $enrollment,
        bool $canManage,
    ): array {
        $data = $course->toArray();

        $serializeLesson = static function (CourseLesson $lesson) use ($enrollment, $canManage): array {
            $contentAvailable = $canManage
                || (bool) $lesson->is_preview
                || ($enrollment !== null
                    && CourseLessonService::availability($lesson, $enrollment->enrolled_at)['available']);

            if ($contentAvailable) {
                return $lesson->toArray();
            }

            return array_intersect_key($lesson->toArray(), array_flip([
                'id',
                'course_id',
                'section_id',
                'title',
                'content_type',
                'position',
                'is_preview',
            ]));
        };

        $data['sections'] = $course->sections
            ->map(static function ($section) use ($serializeLesson): array {
                $sectionData = $section->toArray();
                $sectionData['lessons'] = $section->lessons->map($serializeLesson)->all();

                return $sectionData;
            })
            ->all();
        $data['unassigned_lessons'] = $course->unassignedLessons
            ->map($serializeLesson)
            ->all();

        return $data;
    }

    public static function create(int $authorUserId, array $data): Course
    {
        $title = trim((string) ($data['title'] ?? ''));

        // Only content/economic fields are mass-assignable (see Course::$fillable).
        $course = new Course([
            'category_id' => $data['category_id'] ?? null,
            'title' => $title,
            'slug' => self::uniqueSlug($data['slug'] ?? $title),
            'summary' => $data['summary'] ?? null,
            'description' => $data['description'] ?? null,
            'cover_image' => $data['cover_image'] ?? null,
            'level' => self::enumValue($data['level'] ?? null, self::LEVELS, 'beginner'),
            'visibility' => self::enumValue($data['visibility'] ?? null, self::VISIBILITIES, 'members'),
            'enrollment_type' => self::enumValue($data['enrollment_type'] ?? null, self::ENROLLMENT_TYPES, 'self_paced'),
            'credit_cost' => self::nonNegativeDecimal($data['credit_cost'] ?? 0),
            'learner_credit_reward' => self::nonNegativeDecimal($data['learner_credit_reward'] ?? 0),
            'instructor_credit_reward' => self::nonNegativeDecimal($data['instructor_credit_reward'] ?? 0),
            'prerequisites' => self::allowedPrerequisites($data['prerequisites'] ?? null, $authorUserId, null),
        ]);

        // Author identity and lifecycle/moderation state are set server-side only —
        // never from the caller's payload — so they can't be spoofed.
        $course->tenant_id = (int) TenantContext::getId();
        $course->author_user_id = $authorUserId;
        $course->status = 'draft';
        $course->moderation_status = 'pending';
        $course->save();

        return $course;
    }

    public static function update(Course $course, array $data): Course
    {
        $fields = [
            'category_id', 'title', 'summary', 'description', 'cover_image',
            'level', 'visibility', 'enrollment_type', 'credit_cost',
            'learner_credit_reward', 'instructor_credit_reward', 'prerequisites',
        ];

        $wasApproved = $course->moderation_status === 'approved';

        foreach ($fields as $field) {
            if (array_key_exists($field, $data)) {
                $course->{$field} = match ($field) {
                    'level' => self::enumValue($data[$field], self::LEVELS, $course->level),
                    'visibility' => self::enumValue($data[$field], self::VISIBILITIES, $course->visibility),
                    'enrollment_type' => self::enumValue($data[$field], self::ENROLLMENT_TYPES, $course->enrollment_type),
                    'credit_cost', 'learner_credit_reward', 'instructor_credit_reward' => self::nonNegativeDecimal($data[$field]),
                    // F-183: only courses the author may see can be named as
                    // prerequisites, or their titles leak through the
                    // prerequisites endpoint.
                    'prerequisites' => self::allowedPrerequisites($data[$field], (int) $course->author_user_id, (int) $course->id),
                    default => $data[$field],
                };
            }
        }

        // F-182: when the community moderates courses, an approved course whose
        // content changes goes back to the review queue, as podcasts do.
        $materiallyChanged = $course->isDirty(['title', 'summary', 'description', 'cover_image', 'visibility']);
        if ($materiallyChanged && $wasApproved && self::moderationEnabled()) {
            $course->moderation_status = 'pending';
            $course->moderation_notes = null;
            $course->moderated_by = null;
            $course->moderated_at = null;
        }

        $course->save();
        self::syncFeedActivity($course);

        return $course;
    }

    /**
     * Publish a course. Moderation gate: tenants with moderation enabled keep
     * the course pending until an admin approves; otherwise auto-approve.
     */
    public static function publish(Course $course, bool $autoApprove = true): Course
    {
        $tenantId = (int) ($course->tenant_id ?: TenantContext::getId());

        return TenantContext::runForTenant($tenantId, function () use ($course, $autoApprove): Course {
            $course->status = 'published';
            $moderationEnabled = self::moderationEnabled();

            if ($course->moderation_status === 'rejected') {
                // F-182: republishing must not undo an admin's rejection. The
                // course goes back to the review queue instead.
                $course->moderation_status = 'pending';
            } elseif ($course->moderation_status === 'flagged') {
                // F-182: a flag stays until an admin clears it.
            } elseif ($autoApprove && !$moderationEnabled) {
                $course->moderation_status = 'approved';
            } elseif ($course->moderation_status !== 'approved') {
                $course->moderation_status = 'pending';
            }
            if (!$course->published_at && $course->moderation_status === 'approved') {
                $course->published_at = now();
            }
            $course->save();

            // Post (or restore) the course's card in the community feed once it
            // is live. Guarded inside so a feed failure never blocks publishing.
            self::syncFeedActivity($course);

            return $course;
        });
    }

    public static function unpublish(Course $course): Course
    {
        $course->status = 'draft';
        $course->save();
        self::syncFeedActivity($course);

        return $course;
    }

    public static function delete(Course $course): bool
    {
        $courseId = (int) $course->id;
        $tenantId = (int) ($course->tenant_id ?: TenantContext::getId());
        $deleted = (bool) $course->delete();

        if ($deleted) {
            // F-181: a deleted course must not leave its card in the feed.
            try {
                DB::table('feed_activity')
                    ->where('tenant_id', $tenantId)
                    ->where('source_type', 'course')
                    ->where('source_id', $courseId)
                    ->delete();
            } catch (\Throwable $e) {
                Log::warning('[CourseService] feed card removal on delete failed', ['error' => $e->getMessage()]);
            }
        }

        return $deleted;
    }

    /**
     * Keep a course's community-feed card in step with its lifecycle (F-181).
     *
     * The card is shown only while the course is published, approved and open
     * to the whole community (public or members). Group-only courses are kept
     * out of the community feed, as podcasts are: a feed card carries one group
     * and a course can be linked to several. An existing card is re-shown in
     * place rather than re-recorded, so republishing does not bump it to the top.
     */
    public static function syncFeedActivity(Course $course): void
    {
        try {
            $tenantId = (int) ($course->tenant_id ?: TenantContext::getId());
            $eligible = $course->status === 'published'
                && $course->moderation_status === 'approved'
                && in_array($course->visibility, ['public', 'members'], true);

            $existing = DB::table('feed_activity')
                ->where('tenant_id', $tenantId)
                ->where('source_type', 'course')
                ->where('source_id', (int) $course->id)
                ->exists();

            if (!$eligible) {
                if ($existing) {
                    DB::table('feed_activity')
                        ->where('tenant_id', $tenantId)
                        ->where('source_type', 'course')
                        ->where('source_id', (int) $course->id)
                        ->update(['is_visible' => 0]);
                }
                return;
            }

            $payload = [
                'title' => $course->title,
                'content' => (string) ($course->summary ?? ''),
                'image_url' => $course->cover_image,
                'metadata' => ['slug' => $course->slug, 'level' => $course->level],
            ];

            if ($existing) {
                DB::table('feed_activity')
                    ->where('tenant_id', $tenantId)
                    ->where('source_type', 'course')
                    ->where('source_id', (int) $course->id)
                    ->update([
                        'title' => $payload['title'],
                        'content' => $payload['content'],
                        'image_url' => $payload['image_url'],
                        'metadata' => json_encode($payload['metadata']),
                        'group_id' => null,
                        'is_visible' => 1,
                    ]);
                return;
            }

            app(FeedActivityService::class)->recordActivity(
                $tenantId,
                (int) $course->author_user_id,
                'course',
                (int) $course->id,
                $payload
            );
        } catch (\Throwable $e) {
            Log::warning('[CourseService] feed card sync failed', ['course_id' => $course->id, 'error' => $e->getMessage()]);
        }
    }

    /**
     * F-182: lesson content added, changed or removed after approval sends an
     * approved course back to the review queue when the community moderates
     * courses, as a material edit of the course itself does.
     */
    public static function requeueAfterContentChange(Course $course): void
    {
        if ($course->moderation_status !== 'approved' || !self::moderationEnabled()) {
            return;
        }

        $course->moderation_status = 'pending';
        $course->moderation_notes = null;
        $course->moderated_by = null;
        $course->moderated_at = null;
        $course->save();
        self::syncFeedActivity($course);
    }

    private static function moderationEnabled(): bool
    {
        return filter_var(
            TenantContext::getSetting('courses.moderation_enabled', false),
            FILTER_VALIDATE_BOOLEAN
        );
    }

    /**
     * F-183: keep only prerequisite ids the author may see — their own courses,
     * or courses published, approved and open to the whole community. Anything
     * else (someone's draft, a rejected or group-only course, another tenant's
     * id) is dropped, so its title cannot be read back through the
     * prerequisites endpoint.
     *
     * @return array<int,int>|null
     */
    private static function allowedPrerequisites(mixed $raw, int $authorUserId, ?int $courseId): ?array
    {
        if ($raw === null) {
            return null;
        }
        if (!is_array($raw)) {
            return [];
        }

        $ids = array_values(array_unique(array_filter(
            array_map('intval', $raw),
            static fn (int $id): bool => $id > 0 && $id !== $courseId
        )));
        if ($ids === []) {
            return [];
        }

        $allowed = Course::query()
            ->whereIn('id', $ids)
            ->where(function ($q) use ($authorUserId) {
                $q->where('author_user_id', $authorUserId)
                    ->orWhere(function ($p) {
                        $p->where('status', 'published')
                            ->where('moderation_status', 'approved')
                            ->whereIn('visibility', ['public', 'members']);
                    });
            })
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        return array_values(array_intersect($ids, $allowed));
    }

    private static function uniqueSlug(string $base): string
    {
        $slug = Str::slug($base) ?: 'course';
        $candidate = $slug;
        $i = 2;

        // withoutGlobalScope not needed — uniqueness is per-tenant, which is the
        // desired behaviour (slugs only need to be unique within a tenant).
        while (Course::where('slug', $candidate)->exists()) {
            $candidate = $slug . '-' . $i;
            $i++;
        }

        return $candidate;
    }

    /**
     * @param array<int,string> $allowed
     */
    private static function enumValue(mixed $value, array $allowed, string $default): string
    {
        $candidate = is_string($value) ? $value : '';
        return in_array($candidate, $allowed, true) ? $candidate : $default;
    }

    private static function nonNegativeDecimal(mixed $value): float
    {
        return round(max(0, (float) $value), 2);
    }
}
