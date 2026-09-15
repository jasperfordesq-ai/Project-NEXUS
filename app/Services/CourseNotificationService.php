<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Course;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * CourseNotificationService — learner notifications for the Courses module.
 *
 * Every render is wrapped in LocaleContext::withLocale($recipient, …) so the
 * message resolves in the recipient's preferred_language (not the caller's
 * locale), per the platform's notification-locale rule. All sends are guarded
 * so a notification failure never blocks the triggering action.
 */
class CourseNotificationService
{
    /** In-app notification on enrolment. */
    public static function enrolled(int $courseId, int $userId): void
    {
        try {
            $course = Course::find($courseId);
            $user = self::recipient($userId);
            if (!$course || !$user) {
                return;
            }

            LocaleContext::withLocale($user, function () use ($course, $userId) {
                $message = __('svc_notifications_2.course.enrolled', ['title' => $course->title]);
                Notification::createNotification($userId, $message, self::courseUrl($course->slug), 'course');
                \App\Services\NotificationDispatcher::fanOutPush((int) $userId, 'course', $message, self::courseUrl($course->slug));
            });
        } catch (\Throwable $e) {
            Log::warning('[CourseNotification] enrolled failed', ['error' => $e->getMessage()]);
        }
    }

    /** In-app notification + completion email (with certificate CTA). */
    public static function completed(int $courseId, int $userId): void
    {
        try {
            self::completedReliably($courseId, $userId);
        } catch (\Throwable $e) {
            Log::warning('[CourseNotification] completed failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Deliver a course-completion notice with replay-safe bell and email state.
     * Throws when durable email acceptance is not established so the caller's
     * completion outbox can retry it.
     */
    public static function completedReliably(int $courseId, int $userId, ?string $idempotencyKey = null): void
    {
        $course = Course::find($courseId);
        $user = self::recipient($userId);
        if (!$course || !$user) {
            throw new \RuntimeException('course_completion_notification_source_missing');
        }
        $idempotencyKey ??= sprintf(
            'course-completed:%d:%d:%d',
            TenantContext::getId(),
            $courseId,
            $userId,
        );

        LocaleContext::withLocale($user, function () use ($course, $user, $userId, $idempotencyKey): void {
            $link = self::courseUrl($course->slug);
            $message = __('svc_notifications_2.course.completed', ['title' => $course->title]);

            $bellExists = DB::table('notifications')
                ->where('tenant_id', TenantContext::getId())
                ->where('user_id', $userId)
                ->where('idempotency_key', $idempotencyKey)
                ->exists();
            if (!$bellExists) {
                Notification::createNotification(
                    $userId,
                    $message,
                    $link,
                    'course',
                    false,
                    TenantContext::getId(),
                    $idempotencyKey,
                );
                NotificationDispatcher::fanOutPush($userId, 'course', $message, $link);
            }

            if (empty($user->email) || self::successfulCompletionEmailExists($idempotencyKey)) {
                return;
            }

            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
            $html = EmailTemplateBuilder::make()
                ->title(__('emails_misc.course_completed.title'))
                ->greeting($firstName)
                ->paragraph(__('emails_misc.course_completed.body', ['title' => $course->title]))
                ->button(__('emails_misc.course_completed.cta'), $link)
                ->render();

            $sent = EmailDispatchService::sendRaw(
                $user->email,
                __('emails_misc.course_completed.subject', ['title' => $course->title]),
                $html,
                null,
                null,
                null,
                'course_completed',
                [
                    'tenant_id' => TenantContext::getId(),
                    'idempotency_key' => $idempotencyKey,
                    'dispatch_id' => substr(hash('sha256', $idempotencyKey), 0, 64),
                ]
            );
            if (!$sent) {
                throw new \RuntimeException('course_completion_email_not_accepted');
            }
        });
    }

    private static function successfulCompletionEmailExists(string $idempotencyKey): bool
    {
        if (!Schema::hasTable('email_log') || !Schema::hasColumn('email_log', 'idempotency_key')) {
            return false;
        }

        return DB::table('email_log')
            ->where('tenant_id', TenantContext::getId())
            ->where('idempotency_key', $idempotencyKey)
            ->whereIn('status', ['sent', 'delivered'])
            ->exists();
    }

    /**
     * Recipient row including preferred_language (required for the locale wrap).
     */
    private static function recipient(int $userId): ?object
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->select('id', 'email', 'name', 'first_name', 'preferred_language', 'tenant_id')
            ->first();
    }

    private static function courseUrl(string $slug): string
    {
        return TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/courses/' . $slug;
    }
}
