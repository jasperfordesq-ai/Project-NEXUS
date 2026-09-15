<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseEnrollment;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Durable repair boundary for integrations emitted after course completion. */
final class CourseCompletionDeliveryService
{
    private const MAX_ATTEMPTS = 8;
    private const CLAIM_MINUTES = 5;

    /** Must be called in the same transaction that completes the enrollment. */
    public static function record(CourseEnrollment $enrollment): void
    {
        DB::table('course_completion_delivery_outbox')->insertOrIgnore([
            'tenant_id' => (int) $enrollment->tenant_id,
            'enrollment_id' => (int) $enrollment->id,
            'course_id' => (int) $enrollment->course_id,
            'user_id' => (int) $enrollment->user_id,
            'attempts' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function dispatchForEnrollment(int $tenantId, int $enrollmentId, bool $retryNow = false): bool
    {
        $id = DB::table('course_completion_delivery_outbox')
            ->where('tenant_id', $tenantId)
            ->where('enrollment_id', $enrollmentId)
            ->value('id');

        return $id !== null && $this->dispatchOutboxId((int) $id, $retryNow);
    }

    /** @return array{claimed:int,completed:int,retried:int,dead_lettered:int} */
    public function processBatch(int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $ids = DB::table('course_completion_delivery_outbox')
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->where(function ($query): void {
                $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
            })
            ->where(function ($query): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', now());
            })
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        $summary = ['claimed' => 0, 'completed' => 0, 'retried' => 0, 'dead_lettered' => 0];
        foreach ($ids as $id) {
            $before = DB::table('course_completion_delivery_outbox')->where('id', $id)->first();
            if ($before === null) {
                continue;
            }

            $completed = $this->dispatchOutboxId($id);
            $after = DB::table('course_completion_delivery_outbox')->where('id', $id)->first();
            if ($after === null || (int) $after->attempts <= (int) $before->attempts) {
                continue;
            }

            $summary['claimed']++;
            if ($completed) {
                $summary['completed']++;
            } else {
                $summary[$after->dead_lettered_at === null ? 'retried' : 'dead_lettered']++;
            }
        }

        return $summary;
    }

    private function dispatchOutboxId(int $id, bool $retryNow = false): bool
    {
        $now = now();
        $claimed = DB::table('course_completion_delivery_outbox')
            ->where('id', $id)
            ->whereNull('completed_at')
            ->whereNull('dead_lettered_at')
            ->when(! $retryNow, function ($query) use ($now): void {
                $query->where(function ($due) use ($now): void {
                    $due->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now);
                });
            })
            ->where(function ($query) use ($now): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', $now);
            })
            ->update([
                'attempts' => DB::raw('attempts + 1'),
                'claim_until' => $now->copy()->addMinutes(self::CLAIM_MINUTES),
                'updated_at' => $now,
            ]);

        if ($claimed !== 1) {
            return DB::table('course_completion_delivery_outbox')
                ->where('id', $id)
                ->whereNotNull('completed_at')
                ->exists();
        }

        $row = DB::table('course_completion_delivery_outbox')->where('id', $id)->first();
        if ($row === null) {
            return false;
        }

        try {
            TenantContext::runForTenant((int) $row->tenant_id, function () use ($row): void {
                $enrollment = CourseEnrollment::withoutGlobalScopes()
                    ->whereKey((int) $row->enrollment_id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->where('course_id', (int) $row->course_id)
                    ->where('user_id', (int) $row->user_id)
                    ->where('status', 'completed')
                    ->first();
                $course = Course::withoutGlobalScopes()
                    ->whereKey((int) $row->course_id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->first();
                $user = User::withoutGlobalScopes()
                    ->whereKey((int) $row->user_id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->first();
                if ($enrollment === null || $course === null || $user === null) {
                    throw new \RuntimeException('course_completion_delivery_source_missing');
                }

                CourseCertificateService::issue((int) $row->course_id, (int) $row->user_id);
                CourseNotificationService::completedReliably(
                    (int) $row->course_id,
                    (int) $row->user_id,
                    $this->idempotencyKey($row),
                );

                $xpReference = 'course-completion:' . (int) $row->enrollment_id;
                GamificationService::awardXP(
                    (int) $row->user_id,
                    50,
                    'course.completed',
                    __('svc_notifications_2.course.completed', ['title' => $course->title]),
                    $xpReference,
                );
                if (! DB::table('user_xp_log')
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->where('user_id', (int) $row->user_id)
                    ->where('action', 'course.completed')
                    ->where('source_reference', $xpReference)
                    ->exists()) {
                    throw new \RuntimeException('course_completion_xp_not_recorded');
                }
                GamificationService::awardBadgeByKey((int) $row->user_id, 'course_graduate');
            });

            DB::table('course_completion_delivery_outbox')->where('id', $id)->update([
                'completed_at' => now(),
                'claim_until' => null,
                'next_attempt_at' => null,
                'last_error' => null,
                'updated_at' => now(),
            ]);
            return true;
        } catch (\Throwable $error) {
            $attempts = (int) $row->attempts;
            $dead = $attempts >= self::MAX_ATTEMPTS;
            $safeError = $this->safeError($error);
            DB::table('course_completion_delivery_outbox')->where('id', $id)->update([
                'claim_until' => null,
                'next_attempt_at' => $dead ? null : $this->nextAttemptAt($attempts),
                'dead_lettered_at' => $dead ? now() : null,
                'last_error' => $safeError,
                'updated_at' => now(),
            ]);
            Log::log($dead ? 'critical' : 'warning', 'Course completion delivery failed', [
                'outbox_id' => $id,
                'enrollment_id' => (int) $row->enrollment_id,
                'tenant_id' => (int) $row->tenant_id,
                'attempt' => $attempts,
                'dead_lettered' => $dead,
                'error' => $safeError,
            ]);
            return false;
        }
    }

    private function idempotencyKey(object $row): string
    {
        return sprintf(
            'course-completed:%d:%d:%d',
            (int) $row->tenant_id,
            (int) $row->course_id,
            (int) $row->user_id,
        );
    }

    private function nextAttemptAt(int $attempt): Carbon
    {
        $minutes = [1, 2, 5, 15, 30, 60, 180][$attempt - 1] ?? 360;
        return now()->addMinutes($minutes);
    }

    private function safeError(\Throwable $error): string
    {
        $message = trim($error->getMessage()) ?: $error::class;
        $singleLine = preg_replace('/[\r\n\t]+/', ' ', $message) ?? 'course_completion_delivery_failed';
        return EventNotificationErrorSanitizer::sanitize($singleLine, 255);
    }
}
