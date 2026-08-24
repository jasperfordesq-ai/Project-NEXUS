<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\CourseLesson;
use App\Models\CourseSection;
use Carbon\Carbon;

/**
 * CourseLessonService — tenant-scoped lesson CRUD for the course builder.
 */
class CourseLessonService
{
    private const CONTENT_TYPES = ['video', 'text', 'pdf', 'embed', 'quiz'];
    private const DRIP_TYPES = ['none', 'days_after_enroll', 'fixed_date'];

    private const FIELDS = [
        'section_id', 'title', 'content_type', 'body', 'transcript', 'video_url',
        'attachment_url', 'embed_url', 'position', 'min_watch_percent',
        'drip_type', 'drip_offset_days', 'drip_date', 'is_preview',
    ];

    public static function create(int $courseId, array $data): CourseLesson
    {
        $payload = [
            'course_id' => $courseId,
            'title' => trim((string) ($data['title'] ?? '')),
            'content_type' => $data['content_type'] ?? 'text',
            'position' => (int) ($data['position'] ?? self::nextPosition($courseId)),
        ];

        foreach (self::FIELDS as $field) {
            if ($field !== 'title' && array_key_exists($field, $data)) {
                $payload[$field] = self::normaliseField($field, $data[$field]);
            }
        }

        $payload['section_id'] = self::sectionIdInCourse($payload['section_id'] ?? null, $courseId);

        return CourseLesson::create($payload);
    }

    public static function update(int $id, array $data): ?CourseLesson
    {
        $lesson = CourseLesson::find($id);
        if (!$lesson) {
            return null;
        }

        if (array_key_exists('title', $data)) {
            $lesson->title = trim((string) $data['title']);
        }
        foreach (self::FIELDS as $field) {
            if ($field !== 'title' && array_key_exists($field, $data)) {
                $value = self::normaliseField($field, $data[$field]);
                $lesson->{$field} = $field === 'section_id'
                    ? self::sectionIdInCourse($value, (int) $lesson->course_id)
                    : $value;
            }
        }
        $lesson->save();

        return $lesson;
    }

    public static function delete(int $id): bool
    {
        $lesson = CourseLesson::find($id);
        if (!$lesson) {
            return false;
        }

        return (bool) $lesson->delete();
    }

    /**
     * Ordered count of lessons in a course (used for progress percentage).
     */
    public static function countForCourse(int $courseId): int
    {
        return CourseLesson::where('course_id', $courseId)->count();
    }

    /**
     * Compute drip availability of a lesson for an enrollment.
     *
     * @param CourseLesson $lesson
     * @param string|\DateTimeInterface|null $enrolledAt  When the learner enrolled.
     * @return array{available:bool,unlock_at:?string}
     */
    public static function availability(CourseLesson $lesson, $enrolledAt): array
    {
        $type = $lesson->drip_type ?? 'none';

        if ($type === 'none' || !$enrolledAt) {
            return ['available' => true, 'unlock_at' => null];
        }

        $now = Carbon::now();

        if ($type === 'days_after_enroll') {
            $days = (int) ($lesson->drip_offset_days ?? 0);
            $unlock = Carbon::parse($enrolledAt)->addDays($days);
            return ['available' => $now->gte($unlock), 'unlock_at' => $unlock->toIso8601String()];
        }

        if ($type === 'fixed_date') {
            if (!$lesson->drip_date) {
                return ['available' => true, 'unlock_at' => null];
            }
            $unlock = Carbon::parse($lesson->drip_date);
            return ['available' => $now->gte($unlock), 'unlock_at' => $unlock->toIso8601String()];
        }

        return ['available' => true, 'unlock_at' => null];
    }

    private static function nextPosition(int $courseId): int
    {
        return (int) CourseLesson::where('course_id', $courseId)->max('position') + 1;
    }

    public static function normalizeMediaUrl(?string $value): ?string
    {
        $raw = trim((string) $value);
        if ($raw === '' || filter_var($raw, FILTER_VALIDATE_URL) === false) {
            return null;
        }

        $scheme = strtolower((string) parse_url($raw, PHP_URL_SCHEME));
        return in_array($scheme, ['http', 'https'], true) ? $raw : null;
    }

    private static function normaliseField(string $field, mixed $value): mixed
    {
        if (in_array($field, ['video_url', 'attachment_url', 'embed_url'], true)) {
            return self::normalizeMediaUrl(is_string($value) ? $value : null);
        }

        if ($field === 'content_type') {
            return in_array($value, self::CONTENT_TYPES, true) ? $value : 'text';
        }

        if ($field === 'drip_type') {
            return in_array($value, self::DRIP_TYPES, true) ? $value : 'none';
        }

        if ($field === 'min_watch_percent') {
            return max(0, min(100, (int) $value));
        }

        if (in_array($field, ['position', 'drip_offset_days'], true)) {
            return max(0, (int) $value);
        }

        return $value;
    }

    private static function sectionIdInCourse(mixed $sectionId, int $courseId): ?int
    {
        if ($sectionId === null || $sectionId === '') {
            return null;
        }

        $id = (int) $sectionId;
        if ($id <= 0) {
            return null;
        }

        return CourseSection::where('id', $id)->where('course_id', $courseId)->exists()
            ? $id
            : null;
    }
}
