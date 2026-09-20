<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Course;
use App\Models\CourseLesson;
use App\Models\CourseSection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CourseCurriculumOrderService
{
    /** @return list<int> */
    public static function sections(int $courseId, array $expectedIds, array $orderedIds): array
    {
        return self::apply($courseId, CourseSection::where('course_id', $courseId), $expectedIds, $orderedIds);
    }

    /** @return list<int> */
    public static function lessons(int $courseId, int $sectionId, array $expectedIds, array $orderedIds): array
    {
        return self::apply($courseId, CourseLesson::where('course_id', $courseId)->where('section_id', $sectionId), $expectedIds, $orderedIds);
    }

    private static function apply(int $courseId, Builder $query, array $expectedIds, array $orderedIds): array
    {
        return DB::transaction(function () use ($courseId, $query, $expectedIds, $orderedIds) {
            Course::whereKey($courseId)->lockForUpdate()->firstOrFail();
            // Lock in ID order; positions are mutable and can contain historical ties.
            $rows = $query->orderBy('id')->lockForUpdate()->get();
            $currentIds = $rows->sortBy([['position', 'asc'], ['id', 'asc']])->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
            $sortedIds = $currentIds;
            $sortedOrder = $orderedIds;
            sort($sortedIds);
            sort($sortedOrder);
            if ($sortedIds !== $sortedOrder || count(array_unique($orderedIds)) !== count($orderedIds)) {
                throw ValidationException::withMessages(['ordered_ids' => __('api_controllers_2.courses.order_invalid')]);
            }
            // Deterministic replay after a response is lost must not swap twice.
            if ($currentIds !== $orderedIds && $currentIds !== $expectedIds) {
                throw new \DomainException('COURSE_ORDER_CHANGED');
            }
            $positions = array_flip($orderedIds);
            foreach ($rows as $row) {
                $row->position = $positions[$row->id];
                $row->save();
            }
            return $orderedIds;
        });
    }
}
