<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\CourseCohort;
use App\Models\CourseLesson;
use App\Models\CourseQuestion;
use App\Models\CourseQuiz;
use App\Models\CourseSection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/** Durable response-loss recovery for child resources created in the course editor. */
final class CourseAuthoringCreationReceiptService
{
    private const RESOURCE_TYPES = ['cohort', 'section', 'lesson', 'quiz', 'question'];

    /** @return array{key_hash:string,request_hash:string}|null|false */
    public static function identity(?string $key, string $resourceType, int $courseId, array $intent): array|null|false
    {
        $key = trim((string) $key);
        if ($key === '') return null;
        if (strlen($key) < 8 || strlen($key) > 191 || ! in_array($resourceType, self::RESOURCE_TYPES, true)) {
            return false;
        }

        unset($intent['idempotency_key']);
        $request = ['resource_type' => $resourceType, 'course_id' => $courseId, 'intent' => $intent];

        return [
            'key_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', json_encode(
                self::canonicalize($request),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            )),
        ];
    }

    /**
     * @param array{key_hash:string,request_hash:string} $identity
     * @param callable():Model $create
     * @return array{resource:Model,replayed:bool}
     */
    public static function create(
        int $userId,
        int $courseId,
        string $resourceType,
        array $identity,
        callable $create,
    ): array {
        return DB::transaction(function () use ($userId, $courseId, $resourceType, $identity, $create): array {
            $tenantId = (int) TenantContext::getId();
            DB::table('users')->where('tenant_id', $tenantId)->where('id', $userId)->lockForUpdate()->exists();

            $receipt = DB::table('course_authoring_creation_receipts')
                ->where('tenant_id', $tenantId)
                ->where('actor_user_id', $userId)
                ->where('idempotency_key_hash', $identity['key_hash'])
                ->first();
            if ($receipt) {
                if (! hash_equals((string) $receipt->request_hash, $identity['request_hash'])
                    || (int) $receipt->course_id !== $courseId
                    || (string) $receipt->resource_type !== $resourceType) {
                    throw new \InvalidArgumentException('Idempotency key was reused for different course authoring content');
                }

                $resource = self::findResource($resourceType, $courseId, (int) $receipt->result_id);
                if (! $resource) throw new \DomainException('Course authoring result is no longer available');

                return ['resource' => $resource, 'replayed' => true];
            }

            $resource = $create();
            DB::table('course_authoring_creation_receipts')->insert([
                'tenant_id' => $tenantId,
                'actor_user_id' => $userId,
                'course_id' => $courseId,
                'resource_type' => $resourceType,
                'idempotency_key_hash' => $identity['key_hash'],
                'request_hash' => $identity['request_hash'],
                'result_id' => (int) $resource->getKey(),
                'created_at' => now(),
            ]);

            return ['resource' => $resource, 'replayed' => false];
        });
    }

    private static function findResource(string $resourceType, int $courseId, int $resultId): ?Model
    {
        return match ($resourceType) {
            'cohort' => CourseCohort::where('course_id', $courseId)->find($resultId),
            'section' => CourseSection::where('course_id', $courseId)->find($resultId),
            'lesson' => CourseLesson::where('course_id', $courseId)->find($resultId),
            'quiz' => CourseQuiz::where('course_id', $courseId)->find($resultId),
            'question' => CourseQuestion::where('id', $resultId)
                ->whereHas('quiz', fn ($query) => $query->where('course_id', $courseId))
                ->first(),
            default => null,
        };
    }

    private static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) {
            if (is_array($item)) $value[$key] = self::canonicalize($item);
        }
        if (! array_is_list($value)) ksort($value);
        return $value;
    }
}
