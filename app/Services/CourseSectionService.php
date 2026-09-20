<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\CourseSection;
use App\Models\Course;
use App\Models\CourseLesson;
use Illuminate\Support\Facades\DB;

/**
 * CourseSectionService — tenant-scoped section CRUD for the course builder.
 */
class CourseSectionService
{
    public static function create(int $courseId, array $data): CourseSection
    {
        return CourseSection::create([
            'course_id' => $courseId,
            'title' => trim((string) ($data['title'] ?? '')),
            'position' => (int) ($data['position'] ?? self::nextPosition($courseId)),
        ]);
    }

    public static function update(int $id, array $data): ?CourseSection
    {
        $section = CourseSection::find($id);
        if (!$section) {
            return null;
        }

        if (array_key_exists('title', $data)) {
            $section->title = trim((string) $data['title']);
        }
        if (array_key_exists('position', $data)) {
            $section->position = (int) $data['position'];
        }
        $section->save();

        return $section;
    }

    public static function delete(int $id): bool
    {
        $section = CourseSection::find($id);
        if (!$section) {
            return false;
        }

        return DB::transaction(function () use ($section, $id) {
            Course::whereKey($section->course_id)->lockForUpdate()->firstOrFail();
            $current = CourseSection::whereKey($id)->lockForUpdate()->first();
            if (!$current || !$current->delete()) {
                return false;
            }

            // Preserve content, but only detach it when deletion succeeds. Both writes
            // roll back together if a database operation or model observer throws.
            CourseLesson::where('course_id', $current->course_id)
                ->where('section_id', $id)->update(['section_id' => null]);

            return true;
        });
    }

    private static function nextPosition(int $courseId): int
    {
        return (int) CourseSection::where('course_id', $courseId)->max('position') + 1;
    }
}
