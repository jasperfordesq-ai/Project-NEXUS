<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Course;
use App\Models\CourseEnrollment;

/**
 * CoursePrerequisiteService — resolves a course's prerequisite courses and
 * whether a learner has satisfied them (a prerequisite is "met" when the learner
 * has a completed enrollment and satisfies its quiz requirements). Tenant-scoped via the models.
 */
class CoursePrerequisiteService
{
    /**
     * Prerequisite courses for a course, each annotated with the learner's
     * completion state.
     *
     * F-183: pass $canView to list only the prerequisites the caller may see;
     * a draft, rejected or group-only course's title and slug must not be read
     * back through another course. unmetIds() deliberately passes none, so a
     * prerequisite the learner cannot see still gates enrolment.
     *
     * @param (callable(Course):bool)|null $canView
     * @return array<int,array{id:int,title:string,slug:string,completed:bool}>
     */
    public static function statusFor(Course $course, ?int $userId, ?callable $canView = null): array
    {
        $ids = self::prerequisiteIds($course);
        if (!$ids) {
            return [];
        }

        $completedIds = $userId
            ? CourseEnrollment::where('user_id', $userId)
                ->where('status', 'completed')
                ->whereIn('course_id', $ids)
                ->pluck('course_id')
                ->map(fn ($v) => (int) $v)
                ->all()
            : [];

        if ($completedIds !== []) {
            $unmet = CourseProgressService::unmetQuizLessonsByCourse($completedIds, $userId);
            $completedIds = array_values(array_diff($completedIds, array_keys($unmet)));
        }

        return Course::whereIn('id', $ids)
            ->get()
            ->filter(fn (Course $c) => $canView === null || $canView($c))
            ->values()
            ->map(fn ($c) => [
                'id' => (int) $c->id,
                'title' => $c->title,
                'slug' => $c->slug,
                'completed' => in_array((int) $c->id, $completedIds, true),
            ])
            ->all();
    }

    /**
     * Prerequisite course ids the learner has NOT completed.
     *
     * @return array<int,int>
     */
    public static function unmetIds(Course $course, int $userId): array
    {
        $status = self::statusFor($course, $userId);
        return array_values(array_map(
            fn ($p) => $p['id'],
            array_filter($status, fn ($p) => !$p['completed'])
        ));
    }

    /**
     * @return array<int,int>
     */
    private static function prerequisiteIds(Course $course): array
    {
        $raw = $course->prerequisites;
        if (!is_array($raw)) {
            return [];
        }
        return array_values(array_filter(array_map('intval', $raw)));
    }
}
