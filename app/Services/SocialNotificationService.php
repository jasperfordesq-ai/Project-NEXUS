<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplate;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SocialNotificationService — Native Laravel service for social interaction notifications.
 *
 * Handles platform and email notifications for social interactions
 * (likes, comments, shares) across all feed pages and profiles.
 *
 * DB facade / Eloquent instead of legacy Database class.
 */
class SocialNotificationService
{
    private const OWNER_COLUMNS = [
        'post' => ['feed_posts', 'user_id'],
        'feed_post' => ['feed_posts', 'user_id'],
        'blog' => ['posts', 'author_id'],
        'blog_post' => ['posts', 'author_id'],
        'listing' => ['listings', 'user_id'],
        'event' => ['events', 'user_id'],
        'goal' => ['goals', 'user_id'],
        'poll' => ['polls', 'user_id'],
        'resource' => ['resources', 'user_id'],
        'volunteering' => ['vol_opportunities', 'created_by'],
        'volunteering_opportunity' => ['vol_opportunities', 'created_by'],
        'volunteer' => ['vol_opportunities', 'created_by'],
        'review' => ['reviews', 'reviewer_id'],
        'ideation_challenge' => ['ideation_challenges', 'user_id'],
        'challenge' => ['ideation_challenges', 'user_id'],
        'job' => ['job_vacancies', 'user_id'],
        'discussion' => ['group_discussions', 'user_id'],
        'comment' => ['comments', 'user_id'],
    ];

    public function __construct()
    {
    }

    /**
     * Notify user when someone likes their content.
     */
    public static function notifyLike($contentOwnerId, $likerId, $contentType, $contentId, $contentPreview = null): void
    {
        if ($contentOwnerId == $likerId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $liker = DB::table('users')
                ->where('id', $likerId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'avatar_url'])
                ->first();
            $likerName = $liker->name ?? __('emails.common.fallback_someone');

            $owner = DB::table('users')
                ->where('id', $contentOwnerId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (!$owner) {
                return;
            }

            $ownerEmail = $owner->email ?? null;
            $link = self::getContentLink($contentType, $contentId);

            // Render bell text + email content under the recipient's preferred locale.
            LocaleContext::withLocale($owner, function () use ($owner, $contentOwnerId, $liker, $likerName, $contentType, $contentId, $contentPreview, $ownerEmail, $link) {
                $contentLabel = self::getContentLabel($contentType);
                $message = __('notifications.liked_your_content', ['name' => $likerName, 'content_type' => $contentLabel]);

                // 1. Create platform notification (bell)
                Notification::createNotification((int) $contentOwnerId, $message, $link, 'like');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($contentOwnerId), 'like', $message, $link);

                // 2. Send email notification (if user has email and hasn't opted out)
                if ($ownerEmail && self::shouldSendEmail($contentOwnerId, 'like')) {
                    TenantContext::runForTenant((int) $owner->tenant_id, function () use ($owner, $liker, $contentType, $contentId, $contentPreview, $link) {
                        $emailLink = TenantContext::getSlugPrefix() . $link;
                        self::sendLikeEmail($owner, $liker, $contentType, $contentId, $contentPreview, $emailLink);
                    });
                }
            });
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::notifyLike error: " . $e->getMessage());
        }
    }

    /**
     * Notify user when someone comments on their content.
     */
    public static function notifyComment($contentOwnerId, $commenterId, $contentType, $contentId, $commentText, ?int $commentId = null): void
    {
        if ($contentOwnerId == $commenterId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $commenter = DB::table('users')
                ->where('id', $commenterId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'avatar_url'])
                ->first();
            $commenterName = $commenter->name ?? __('emails.common.fallback_someone');

            $owner = DB::table('users')
                ->where('id', $contentOwnerId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (!$owner) {
                return;
            }

            $ownerEmail = $owner->email ?? null;
            $link = $commentId
                ? self::getCommentDeepLink($contentType, $contentId, $commentId)
                : self::getContentLink($contentType, $contentId);
            $shortComment = strlen($commentText) > 50 ? substr($commentText, 0, 50) . '...' : $commentText;

            // Render bell text + email content under the recipient's preferred locale.
            LocaleContext::withLocale($owner, function () use ($owner, $contentOwnerId, $commenter, $commenterName, $contentType, $contentId, $commentText, $shortComment, $ownerEmail, $link) {
                $contentLabel = self::getContentLabel($contentType);
                $message = __('notifications.commented_on_your_content', ['name' => $commenterName, 'content_type' => $contentLabel, 'comment' => $shortComment]);

                // 1. Create platform notification (bell)
                Notification::createNotification((int) $contentOwnerId, $message, $link, 'comment');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($contentOwnerId), 'comment', $message, $link);

                // 2. Send email notification (if user has email and hasn't opted out)
                if ($ownerEmail && self::shouldSendEmail($contentOwnerId, 'comment')) {
                    TenantContext::runForTenant((int) $owner->tenant_id, function () use ($owner, $commenter, $contentType, $contentId, $commentText, $link) {
                        $emailLink = TenantContext::getSlugPrefix() . $link;
                        self::sendCommentEmail($owner, $commenter, $contentType, $contentId, $commentText, $emailLink);
                    });
                }
            });
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::notifyComment error: " . $e->getMessage());
        }
    }

    /**
     * Notify a comment author when someone replies directly to their comment.
     */
    public static function notifyCommentReply(
        int $commentOwnerId,
        int $replierId,
        int $replyCommentId,
        string $contentType,
        int $contentId,
        string $replyText
    ): void {
        if ($commentOwnerId === $replierId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $replier = DB::table('users')
                ->where('id', $replierId)
                ->where('tenant_id', $tenantId)
                ->select(['name', 'avatar_url'])
                ->first();
            $replierName = $replier->name ?? __('emails.common.fallback_someone');

            $owner = DB::table('users')
                ->where('id', $commentOwnerId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (!$owner) {
                return;
            }

            $ownerEmail = $owner->email ?? null;
            $link = self::getCommentDeepLink($contentType, $contentId, $replyCommentId);
            $shortReply = strlen($replyText) > 50 ? substr($replyText, 0, 50) . '...' : $replyText;

            LocaleContext::withLocale($owner, function () use ($owner, $commentOwnerId, $replier, $replierName, $contentType, $replyText, $shortReply, $ownerEmail, $link) {
                $message = __('notifications.replied_to_your_comment', ['name' => $replierName, 'comment' => $shortReply]);

                Notification::createNotification((int) $commentOwnerId, $message, $link, 'comment_reply');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($commentOwnerId), 'comment_reply', $message, $link);

                if ($ownerEmail && self::shouldSendEmail($commentOwnerId, 'comment')) {
                    TenantContext::runForTenant((int) $owner->tenant_id, function () use ($owner, $replier, $contentType, $replyText, $link) {
                        $emailLink = TenantContext::getSlugPrefix() . $link;
                        self::sendCommentReplyEmail($owner, $replier, $contentType, $replyText, $emailLink);
                    });
                }
            });
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::notifyCommentReply error: " . $e->getMessage());
        }
    }

    /**
     * Notify user when someone shares their content.
     */
    public static function notifyShare($contentOwnerId, $sharerId, $contentType, $contentId): void
    {
        if ($contentOwnerId == $sharerId) {
            return;
        }

        try {
            $tenantId = TenantContext::getId();

            $sharer = DB::table('users')
                ->where('id', $sharerId)
                ->where('tenant_id', $tenantId)
                ->select(['name'])
                ->first();
            $sharerName = $sharer->name ?? __('emails.common.fallback_someone');

            $owner = DB::table('users')
                ->where('id', $contentOwnerId)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (!$owner) {
                return;
            }

            $ownerEmail = $owner->email ?? null;
            $link = self::getContentLink($contentType, $contentId);

            // Render bell text + email content under the recipient's preferred locale.
            LocaleContext::withLocale($owner, function () use ($owner, $contentOwnerId, $sharer, $sharerName, $contentType, $contentId, $ownerEmail, $link) {
                $contentLabel = self::getContentLabel($contentType);
                $message = __('notifications.shared_your_content', ['name' => $sharerName, 'content_type' => $contentLabel]);

                // 1. Create platform notification (bell)
                Notification::createNotification((int) $contentOwnerId, $message, $link, 'share');
                \App\Services\NotificationDispatcher::fanOutPush((int) ($contentOwnerId), 'share', $message, $link);

                // 2. Send email notification (if user has email and hasn't opted out)
                if ($ownerEmail && self::shouldSendEmail($contentOwnerId, 'share')) {
                    TenantContext::runForTenant((int) $owner->tenant_id, function () use ($owner, $sharer, $contentType, $contentId, $link) {
                        $emailLink = TenantContext::getSlugPrefix() . $link;
                        self::sendShareEmail($owner, $sharer, $contentType, $contentId, $emailLink);
                    });
                }
            });
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::notifyShare error: " . $e->getMessage());
        }
    }

    /**
     * Get human-readable content label.
     */
    private static function getContentLabel($contentType): string
    {
        $key = 'notifications.content_type_' . $contentType;
        $translated = __($key);
        // If the translation key doesn't exist, fall back to the default
        return $translated !== $key ? $translated : __('notifications.content_type_default');
    }

    /**
     * Get link to content.
     */
    public static function getContentLink($contentType, $contentId): string
    {
        $routes = [
            'post' => '/feed/posts/' . $contentId,
            'feed_post' => '/feed/posts/' . $contentId,
            'blog_post' => self::getBlogLink((int) $contentId),
            'blog' => self::getBlogLink((int) $contentId),
            'listing' => '/listings/' . $contentId,
            'event' => '/events/' . $contentId,
            'goal' => '/goals/' . $contentId,
            'poll' => '/polls/' . $contentId,
            'resource' => '/resources/' . $contentId,
            'volunteering' => '/volunteering/opportunities/' . $contentId,
            'volunteer' => '/volunteering/opportunities/' . $contentId,
            'ideation_challenge' => '/ideation/' . $contentId,
            'challenge' => '/ideation/' . $contentId,
            'challenge_idea' => '/ideation/' . $contentId,
            'review' => '/reviews',
            'job' => '/jobs/' . $contentId,
            'discussion' => self::getDiscussionLink((int) $contentId),
            'comment' => self::getCommentLink((int) $contentId),
        ];
        return $routes[$contentType] ?? '/notifications';
    }

    private static function getBlogLink(int $contentId): string
    {
        try {
            $slug = DB::table('posts')
                ->where('id', $contentId)
                ->where('tenant_id', TenantContext::getId())
                ->value('slug');

            if (is_string($slug) && $slug !== '') {
                return '/blog/' . $slug;
            }
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::getBlogLink error: " . $e->getMessage());
        }

        return '/blog/' . $contentId;
    }

    private static function getDiscussionLink(int $contentId): string
    {
        try {
            $groupId = DB::table('group_discussions')
                ->where('id', $contentId)
                ->where('tenant_id', TenantContext::getId())
                ->value('group_id');

            if ($groupId) {
                return '/groups/' . $groupId . '?tab=discussion&discussion_id=' . $contentId;
            }
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::getDiscussionLink error: " . $e->getMessage());
        }

        return '/groups';
    }

    private static function getCommentLink(int $commentId): string
    {
        try {
            $comment = DB::table('comments')
                ->where('id', $commentId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['target_type', 'target_id'])
                ->first();

            if ($comment && $comment->target_type && $comment->target_id) {
                return self::getCommentDeepLink(
                    (string) $comment->target_type,
                    (int) $comment->target_id,
                    $commentId
                );
            }
        } catch (\Throwable $e) {
            Log::warning("SocialNotificationService::getCommentLink error: " . $e->getMessage());
        }

        // Without the target type/id there is no honest native or web deep link.
        // The authenticated inbox still contains the notification and is safer
        // than opening an unrelated feed while pretending it is the comment.
        return '/notifications';
    }

    private static function getCommentDeepLink($contentType, $contentId, int $commentId): string
    {
        $base = match ($contentType) {
            'post', 'feed_post' => '/feed/posts/' . $contentId,
            default => self::getContentLink($contentType, $contentId),
        };

        return $base . '#comment-' . $commentId;
    }

    /**
     * Check if user should receive email notifications for this type.
     */
    private static function shouldSendEmail($userId, $notificationType): bool
    {
        try {
            $setting = DB::table('notification_settings')
                ->where('user_id', $userId)
                ->where('context_type', 'social')
                ->where('context_id', 0)
                ->value('frequency');

            if ($setting !== null) {
                if ($setting === 'off') {
                    return false;
                }
                return true;
            }

            // Default: send email notifications
            return true;
        } catch (\Throwable $e) {
            // If settings table doesn't exist, default to sending
            return true;
        }
    }

    /**
     * Send like notification email.
     */
    private static function sendLikeEmail($owner, $liker, $contentType, $contentId, $contentPreview, $link): void
    {
        try {
            $tenant = TenantContext::get();
            $tenantName = $tenant['name'] ?? __('emails.common.platform_name');
            $fullLink = TenantContext::getFrontendUrl() . $link;
            $tenantId = (int) $owner->tenant_id;

            $likerName = $liker->name ?? __('emails.common.fallback_someone');
            $contentLabel = self::getContentLabel($contentType);

            $title = __('notifications.email_new_like_title', ['content_type' => ucfirst($contentLabel)]);
            $subtitle = __('notifications.email_liked_subtitle', ['name' => $likerName, 'content_type' => $contentLabel]);
            $body = $contentPreview ? "\"" . htmlspecialchars($contentPreview) . "\"" : __('notifications.content_getting_attention', ['content_type' => $contentLabel]);

            $html = \App\Core\EmailTemplateBuilder::make()
                ->theme('brand')
                ->title($title)
                ->paragraph($subtitle)
                ->paragraph($body)
                ->button(__('notifications.email_view_content', ['content_type' => ucfirst($contentLabel)]), $fullLink)
                ->render();

            $subject = __('notifications.email_subject_with_community', ['title' => $title, 'community' => $tenantName]);
            if (!EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'social_notification', ['tenant_id' => $tenantId])) {
                Log::warning('SocialNotificationService: like email send returned false', [
                    'owner_id' => $owner->id ?? null,
                    'content_type' => $contentType,
                    'content_id' => $contentId,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("sendLikeEmail error: " . $e->getMessage());
        }
    }

    /**
     * Send comment notification email.
     */
    private static function sendCommentEmail($owner, $commenter, $contentType, $contentId, $commentText, $link): void
    {
        try {
            $tenant = TenantContext::get();
            $tenantName = $tenant['name'] ?? __('emails.common.platform_name');
            $fullLink = TenantContext::getFrontendUrl() . $link;
            $tenantId = (int) $owner->tenant_id;

            $commenterName = $commenter->name ?? __('emails.common.fallback_someone');
            $contentLabel = self::getContentLabel($contentType);

            $title = __('notifications.email_new_comment_title', ['content_type' => ucfirst($contentLabel)]);
            $subtitle = __('notifications.email_commented_subtitle', ['name' => $commenterName, 'content_type' => $contentLabel]);
            $body = "\"" . htmlspecialchars($commentText) . "\"";

            $html = \App\Core\EmailTemplateBuilder::make()
                ->theme('brand')
                ->title($title)
                ->paragraph($subtitle)
                ->paragraph($body)
                ->button(__('notifications.email_view_comment'), $fullLink)
                ->render();

            $subject = __('notifications.email_subject_with_community', ['title' => $title, 'community' => $tenantName]);
            if (!EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'social_notification', ['tenant_id' => $tenantId])) {
                Log::warning('SocialNotificationService: comment email send returned false', [
                    'owner_id' => $owner->id ?? null,
                    'content_type' => $contentType,
                    'content_id' => $contentId,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("sendCommentEmail error: " . $e->getMessage());
        }
    }

    /**
     * Send comment reply notification email.
     */
    private static function sendCommentReplyEmail($owner, $replier, string $contentType, string $replyText, string $link): void
    {
        try {
            $tenant = TenantContext::get();
            $tenantName = $tenant['name'] ?? __('emails.common.platform_name');
            $fullLink = TenantContext::getFrontendUrl() . $link;
            $tenantId = (int) $owner->tenant_id;

            $replierName = $replier->name ?? __('emails.common.fallback_someone');
            $contentLabel = self::getContentLabel($contentType);

            $title = __('notifications.email_new_comment_reply_title');
            $subject = __('notifications.email_new_comment_reply_subject', ['title' => $title, 'community' => $tenantName]);
            $subtitle = __('notifications.email_replied_to_comment_subtitle', ['name' => $replierName, 'content_type' => $contentLabel]);
            $body = "\"" . htmlspecialchars($replyText) . "\"";

            $html = \App\Core\EmailTemplateBuilder::make()
                ->theme('brand')
                ->title($title)
                ->paragraph($subtitle)
                ->paragraph($body)
                ->button(__('notifications.email_view_reply'), $fullLink)
                ->render();

            if (!EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'social_notification', ['tenant_id' => $tenantId])) {
                Log::warning('SocialNotificationService: comment reply email send returned false', [
                    'owner_id' => $owner->id ?? null,
                    'content_type' => $contentType,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("sendCommentReplyEmail error: " . $e->getMessage());
        }
    }

    /**
     * Send share notification email.
     */
    private static function sendShareEmail($owner, $sharer, $contentType, $contentId, $link): void
    {
        try {
            $tenant = TenantContext::get();
            $tenantName = $tenant['name'] ?? __('emails.common.platform_name');
            $fullLink = TenantContext::getFrontendUrl() . $link;
            $tenantId = (int) $owner->tenant_id;

            $sharerName = $sharer->name ?? __('emails.common.fallback_someone');
            $contentLabel = self::getContentLabel($contentType);

            $title = __('notifications.email_shared_title', ['content_type' => ucfirst($contentLabel)]);
            $subtitle = __('notifications.email_shared_subtitle', ['name' => $sharerName, 'content_type' => $contentLabel]);
            $body = __('notifications.content_reaching_more');

            $html = \App\Core\EmailTemplateBuilder::make()
                ->theme('brand')
                ->title($title)
                ->paragraph($subtitle)
                ->paragraph($body)
                ->button(__('notifications.email_view_content', ['content_type' => ucfirst($contentLabel)]), $fullLink)
                ->render();

            $subject = __('notifications.email_subject_with_community', ['title' => $title, 'community' => $tenantName]);
            if (!EmailDispatchService::sendRaw($owner->email, $subject, $html, null, null, null, 'social_notification', ['tenant_id' => $tenantId])) {
                Log::warning('SocialNotificationService: share email send returned false', [
                    'owner_id' => $owner->id ?? null,
                    'content_type' => $contentType,
                    'content_id' => $contentId,
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("sendShareEmail error: " . $e->getMessage());
        }
    }

    /**
     * Get content owner ID from database.
     */
    public static function getContentOwnerId($contentType, $contentId): ?int
    {
        try {
            $tenantId = TenantContext::getId();
            $entry = self::OWNER_COLUMNS[$contentType] ?? null;

            if (!$entry) {
                return null;
            }

            [$table, $ownerColumn] = $entry;
            $userId = DB::table($table)
                ->where('id', $contentId)
                ->where('tenant_id', $tenantId)
                ->value($ownerColumn);

            return $userId ? (int) $userId : null;
        } catch (\Throwable $e) {
            Log::warning("getContentOwnerId error: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Get content preview text.
     */
    public static function getContentPreview($contentType, $contentId, $maxLength = 100): string
    {
        try {
            $tenantId = TenantContext::getId();
            $text = '';

            switch ($contentType) {
                case 'post':
                case 'feed_post':
                    $text = (string) DB::table('feed_posts')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->value('content');
                    break;

                case 'blog_post':
                case 'blog':
                    $row = DB::table('posts')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'excerpt'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->excerpt ?? '')) : '';
                    break;

                case 'listing':
                    $row = DB::table('listings')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'event':
                    $row = DB::table('events')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'goal':
                    $row = DB::table('goals')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'poll':
                    $text = (string) DB::table('polls')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->value('question');
                    break;

                case 'resource':
                    $row = DB::table('resources')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'volunteering':
                case 'volunteering_opportunity':
                case 'volunteer':
                    $row = DB::table('vol_opportunities')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'review':
                    $text = (string) DB::table('reviews')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->value('comment');
                    break;

                case 'ideation_challenge':
                case 'challenge':
                    $row = DB::table('ideation_challenges')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'job':
                    $row = DB::table('job_vacancies')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title', 'description'])
                        ->first();
                    $text = $row ? ($row->title . ': ' . ($row->description ?? '')) : '';
                    break;

                case 'discussion':
                    $row = DB::table('group_discussions')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->select(['title'])
                        ->first();
                    $text = $row ? $row->title : '';
                    break;

                case 'comment':
                    $text = (string) DB::table('comments')
                        ->where('id', $contentId)
                        ->where('tenant_id', $tenantId)
                        ->value('content');
                    break;

                default:
                    $text = '';
            }

            if (strlen($text) > $maxLength) {
                $text = substr($text, 0, $maxLength) . '...';
            }

            return $text;
        } catch (\Throwable $e) {
            Log::debug('[SocialNotification] getPostSnippet failed: ' . $e->getMessage());
            return '';
        }
    }
}
