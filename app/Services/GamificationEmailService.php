<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\UserStreak;
use App\Models\UserXpLog;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * GamificationEmailService — Sends weekly progress digests and achievement notifications.
 *
 * Handles monthly digest emails for users with gamification activity
 * and milestone notification emails for achievements.
 */
class GamificationEmailService
{
    public function __construct()
    {
    }

    /**
     * Minimum gap between two gamification milestone emails to the same member.
     *
     * Gamification awards arrive in clusters: creating one listing can trip a
     * badge, a second badge and a level-up within the same request, and each
     * used to become its own email. One member received four emails in three
     * seconds on 2026-09-17. That is the pattern that earns a "report spam"
     * click, and milestone mail earns no engagement to offset it.
     *
     * Overridable via config('mail.gamification_milestone_min_interval_seconds');
     * 0 disables the limit entirely.
     */
    public const MILESTONE_EMAIL_MIN_INTERVAL_SECONDS = 3600;

    private function milestoneEmailSlotKey(int $tenantId, int $userId): string
    {
        return "gamification:milestone-email:{$tenantId}:{$userId}";
    }

    /**
     * Claim this member's milestone-email slot for the current window.
     *
     * Cache::add only writes when the key is absent, so two awards racing in
     * the same second cannot both win it. Returns false when a milestone email
     * already went out inside the window.
     *
     * Fails OPEN: if the cache is unreachable the email is sent. A cache
     * outage must never silently stop milestone mail platform-wide.
     */
    private function claimMilestoneEmailSlot(int $tenantId, int $userId): bool
    {
        $interval = (int) config(
            'mail.gamification_milestone_min_interval_seconds',
            self::MILESTONE_EMAIL_MIN_INTERVAL_SECONDS
        );

        if ($interval <= 0) {
            return true;
        }

        try {
            return (bool) Cache::add($this->milestoneEmailSlotKey($tenantId, $userId), true, $interval);
        } catch (\Throwable $e) {
            Log::debug('GamificationEmailService: milestone rate-limit slot unavailable, sending anyway', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);

            return true;
        }
    }

    /**
     * Hand the slot back when the send did not actually happen, so a failed
     * send does not cost the member their next hour of milestone mail.
     */
    private function releaseMilestoneEmailSlot(int $tenantId, int $userId): void
    {
        try {
            Cache::forget($this->milestoneEmailSlotKey($tenantId, $userId));
        } catch (\Throwable $e) {
            Log::debug('GamificationEmailService: could not release milestone rate-limit slot', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Send monthly progress digests to users who actually have activity.
     *
     * Iterates all active tenants, finds users with XP activity in the past 30 days,
     * generates a digest for each, and sends it through EmailDispatchService.
     *
     * @return array{sent: int, skipped: int, errors: int}
     */
    public function sendWeeklyDigests(): array
    {
        $sent = 0;
        $skipped = 0;
        $errors = 0;

        $previousTenantId = TenantContext::currentId();

        try {
            $tenants = DB::table('tenants')
                ->where('is_active', 1)
                ->select(['id', 'slug', 'name'])
                ->get();
        } catch (\Throwable $e) {
            Log::error('GamificationEmailService: Failed to query tenants', ['error' => $e->getMessage()]);
            return ['sent' => 0, 'skipped' => 0, 'errors' => 1];
        }

        try {
            foreach ($tenants as $tenant) {
                try {
                    TenantContext::setById($tenant->id);
                } catch (\Throwable $e) {
                    Log::warning('GamificationEmailService: Failed to set tenant context', [
                        'tenant_id' => $tenant->id,
                        'error' => $e->getMessage(),
                    ]);
                    $errors++;
                    continue;
                }

                try {
                // Find users with XP activity in the past 30 days
                $activeUserIds = DB::table('user_xp_log')
                    ->where('tenant_id', $tenant->id)
                    ->where('created_at', '>=', now()->subDays(30))
                    ->distinct()
                    ->pluck('user_id')
                    ->all();

                if (empty($activeUserIds)) {
                    continue;
                }

                // Get active users with email addresses
                $users = User::whereIn('id', $activeUserIds)
                    ->where('tenant_id', $tenant->id)
                    ->where('status', 'active')
                    ->whereNotNull('email')
                    ->where('email', '!=', '')
                    ->get(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);

                foreach ($users as $user) {
                    try {
                        // Check email_gamification_digest preference — default to sending (opt-out model)
                        try {
                            $prefs = User::getNotificationPreferences($user->id);
                            if (!((bool) ($prefs['email_gamification_digest'] ?? true))) {
                                $skipped++;
                                continue;
                            }
                        } catch (\Throwable $prefError) {
                            Log::debug('GamificationEmailService: could not read email_gamification_digest pref', [
                                'user_id' => $user->id,
                                'error' => $prefError->getMessage(),
                            ]);
                            // Default to sending on error
                        }

                        $digest = $this->generateUserDigest($user->id);

                        if (empty($digest) || ($digest['xp_earned'] ?? 0) === 0) {
                            $skipped++;
                            continue;
                        }

                        $success = LocaleContext::withLocale($user, function () use ($user, $digest, $tenant) {
                            $name = UserDisplayName::resolve($user);
                            $subject = __('emails.gamification_digest.subject');
                            $body = $this->buildDigestEmailBody($name, $digest, $tenant->name ?? __('emails.common.fallback_tenant_name'));

                            return EmailDispatchService::sendRaw($user->email, $subject, $body, null, null, null, 'gamification_digest', ['tenant_id' => (int) $tenant->id]);
                        });

                        if ($success) {
                            $sent++;
                        } else {
                            $errors++;
                        }
                    } catch (\Throwable $e) {
                        Log::warning('GamificationEmailService: Failed to send digest', [
                            'user_id' => $user->id,
                            'tenant_id' => $tenant->id,
                            'error' => $e->getMessage(),
                        ]);
                        $errors++;
                    }
                }
                } catch (\Throwable $e) {
                    Log::error('GamificationEmailService: Error processing tenant', [
                        'tenant_id' => $tenant->id,
                        'error' => $e->getMessage(),
                    ]);
                    $errors++;
                }
            }
        } finally {
            if (app()->runningInConsole()) {
                TenantContext::reset();
            } elseif ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return ['sent' => $sent, 'skipped' => $skipped, 'errors' => $errors];
    }

    /**
     * Generate a user's monthly digest data.
     *
     * @return array{user_id: int, xp_earned: int, badges_earned: array, streak: int, rank: int|null, level: int}
     */
    public function generateUserDigest(int $userId): array
    {
        $digestSince = now()->subDays(30);

        try {
            // XP earned this week
            $xpEarned = (int) UserXpLog::where('user_id', $userId)
                ->where('created_at', '>=', $digestSince)
                ->sum('xp_amount');
        } catch (\Throwable $e) {
            $xpEarned = 0;
        }

        try {
            // Badges earned this week
            $badgesEarned = UserBadge::where('user_id', $userId)
                ->where('awarded_at', '>=', $digestSince)
                ->get(['badge_key', 'name', 'icon'])
                ->toArray();
        } catch (\Throwable $e) {
            $badgesEarned = [];
        }

        try {
            // Current streak
            $streak = (int) (UserStreak::where('user_id', $userId)
                ->where('streak_type', 'login')
                ->value('current_streak') ?? 0);
        } catch (\Throwable $e) {
            $streak = 0;
        }

        try {
            // User level and XP
            $user = User::find($userId, ['id', 'xp', 'level', 'points']);
            $level = (int) ($user->level ?? 1);
            $totalXp = (int) ($user->xp ?? $user->points ?? 0);
        } catch (\Throwable $e) {
            $level = 1;
            $totalXp = 0;
        }

        // Leaderboard rank: count users with more XP in the same tenant
        $rank = null;
        try {
            $tenantId = TenantContext::getId();
            $rank = (int) DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('is_approved', true)
                ->whereRaw('COALESCE(xp, points, 0) > ?', [$totalXp])
                ->count() + 1;
        } catch (\Throwable $e) {
            // Rank unavailable
        }

        return [
            'user_id'       => $userId,
            'xp_earned'     => $xpEarned,
            'badges_earned' => $badgesEarned,
            'streak'        => $streak,
            'rank'          => $rank,
            'level'         => $level,
        ];
    }

    /**
     * Send a milestone achievement email.
     *
     * @param int    $userId User to notify
     * @param string $type   Milestone type: 'level_up', 'badge_earned', 'streak_milestone', 'leaderboard_top'
     * @param array  $data   Context data for the milestone (varies by type)
     */
    public function sendMilestoneEmail(int $userId, string $type, array $data): bool
    {
        try {
            // Check email_gamification_milestones preference — default to sending (opt-out model)
            try {
                $prefs = User::getNotificationPreferences($userId);
                if (!((bool) ($prefs['email_gamification_milestones'] ?? true))) {
                    return false;
                }
            } catch (\Throwable $prefError) {
                Log::debug('GamificationEmailService: could not read email_gamification_milestones pref', [
                    'user_id' => $userId,
                    'error' => $prefError->getMessage(),
                ]);
                // Default to sending on error
            }

            $user = User::withoutGlobalScopes()
                ->where('id', $userId)
                ->where('status', 'active')
                ->first(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language']);

            if (!$user || empty($user->email)) {
                return false;
            }

            return TenantContext::runForTenant((int) $user->tenant_id, function () use ($user, $type, $data): bool {
                try {
                    $prefs = User::getNotificationPreferences((int) $user->id);
                    if (!((bool) ($prefs['email_gamification_milestones'] ?? true))) {
                        return false;
                    }
                } catch (\Throwable $prefError) {
                    Log::debug('GamificationEmailService: could not read email_gamification_milestones pref', [
                        'user_id' => $user->id,
                        'tenant_id' => $user->tenant_id,
                        'error' => $prefError->getMessage(),
                    ]);
                }

            $tenantId = (int) $user->tenant_id;
            $recipientId = (int) $user->id;

            // One milestone email per member per window. The award itself is
            // unaffected: the in-app notification and push still fire from
            // GamificationService, and the monthly digest still recaps every
            // badge earned, so nothing is lost — only the burst.
            if (!$this->claimMilestoneEmailSlot($tenantId, $recipientId)) {
                Log::info('GamificationEmailService: milestone email suppressed by per-member rate limit', [
                    'tenant_id' => $tenantId,
                    'user_id' => $recipientId,
                    'type' => $type,
                ]);

                return false;
            }

            return LocaleContext::withLocale($user, function () use ($user, $type, $data, $tenantId, $recipientId) {
                $name = UserDisplayName::resolve($user);
                [$subject, $body] = $this->buildMilestoneEmail($name, $type, $data);

                $sent = EmailDispatchService::sendRaw($user->email, $subject, $body, null, null, null, 'gamification_milestone', ['tenant_id' => $tenantId]);

                if (!$sent) {
                    $this->releaseMilestoneEmailSlot($tenantId, $recipientId);
                }

                return $sent;
            });
            });
        } catch (\Throwable $e) {
            Log::error('GamificationEmailService: Failed to send milestone email', [
                'user_id' => $userId,
                'type' => $type,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Build the HTML body for a monthly digest email.
     */
    private function buildDigestEmailBody(string $name, array $digest, string $communityName): string
    {
        $safeCommunity = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');

        $builder = EmailTemplateBuilder::make()
            ->theme('achievement')
            ->title(__('emails.gamification_digest.title'))
            ->previewText(__('emails.gamification_digest.preview', ['xp' => $digest['xp_earned'], 'community' => $safeCommunity]))
            ->greeting($name ?: __('emails.common.fallback_name'))
            ->paragraph(__('emails.gamification_digest.intro', ['community' => $safeCommunity]));

        // Build stat cards — always show XP and Level
        $stats = [
            ['value' => (string) $digest['xp_earned'], 'label' => __('emails.gamification_digest.xp_earned'), 'icon' => "\u{26A1}"],
            ['value' => (string) $digest['level'], 'label' => __('emails.gamification_digest.level'), 'icon' => "\u{1F3C6}"],
        ];

        if ($digest['rank']) {
            $stats[] = ['value' => '#' . $digest['rank'], 'label' => __('emails.gamification_digest.rank'), 'icon' => "\u{1F4CA}"];
        }

        if ($digest['streak'] > 0) {
            $stats[] = ['value' => __('emails.gamification_digest.streak_days', ['days' => $digest['streak']]), 'label' => __('emails.gamification_digest.streak'), 'icon' => "\u{1F525}"];
        }

        $builder->statCards($stats);

        // Badges earned this week
        if (!empty($digest['badges_earned'])) {
            $badgeItems = [];
            foreach ($digest['badges_earned'] as $badge) {
                $icon = $badge['icon'] ?? '';
                $badgeName = htmlspecialchars($badge['name'] ?? $badge['badge_key'] ?? __('emails.gamification_digest.badge_fallback'), ENT_QUOTES, 'UTF-8');
                $badgeItems[] = ['text' => trim("{$icon} {$badgeName}"), 'color' => '#8b5cf6'];
            }
            $builder->badges($badgeItems);
        }

        $builder
            ->paragraph(__('emails.gamification_digest.encouragement'))
            ->button(__('emails.gamification_digest.view_leaderboard'), EmailTemplateBuilder::tenantUrl('/leaderboard'));

        return $builder->render();
    }

    /**
     * Build subject and body for a milestone email.
     *
     * @return array{0: string, 1: string} [subject, body]
     */
    private function buildMilestoneEmail(string $name, string $type, array $data): array
    {

        switch ($type) {
            case 'level_up':
                $level = htmlspecialchars((string) ($data['level'] ?? '?'), ENT_QUOTES, 'UTF-8');
                $subject = __('emails.gamification_milestone.level_up_subject', ['level' => $level]);
                $body = EmailTemplateBuilder::make()
                    ->theme('achievement')
                    ->title(__('emails.gamification_milestone.level_up_title') . " \u{1F389}")
                    ->previewText(__('emails.gamification_milestone.level_up_preview', ['level' => $level]))
                    ->greeting($name)
                    ->highlight(__('emails.gamification_milestone.level_up_highlight', ['level' => $level]), "\u{1F389}")
                    ->paragraph(__('emails.gamification_milestone.level_up_body'))
                    ->button(__('emails.gamification_milestone.view_profile'), EmailTemplateBuilder::tenantUrl('/profile'))
                    ->render();
                break;

            case 'badge_earned':
                $badgeNameRaw = (string) ($data['badge_name'] ?? $data['name'] ?? __('emails.gamification_milestone.badge_fallback'));
                $badgeName = htmlspecialchars($badgeNameRaw, ENT_QUOTES, 'UTF-8');
                $badgeIcon = $data['icon'] ?? '';
                // Plain-text MIME subject - raw value, no HTML entities.
                $subject = __('emails.gamification_milestone.badge_earned_subject', ['badge' => $badgeNameRaw]);
                $builder = EmailTemplateBuilder::make()
                    ->theme('achievement')
                    ->title(__('emails.gamification_milestone.badge_earned_title') . " {$badgeIcon}")
                    ->previewText(__('emails.gamification_milestone.badge_earned_preview', ['badge' => $badgeNameRaw]))
                    ->greeting($name)
                    ->highlight(__('emails.gamification_milestone.badge_earned_highlight', ['icon' => $badgeIcon, 'badge' => $badgeName]), "\u{1F3C5}");

                if (!empty($data['description'])) {
                    $builder->paragraph(htmlspecialchars($data['description'], ENT_QUOTES, 'UTF-8'));
                } else {
                    $builder->paragraph(__('emails.gamification_milestone.badge_earned_body'));
                }

                $body = $builder
                    ->button(__('emails.gamification_milestone.view_badges'), EmailTemplateBuilder::tenantUrl('/profile'))
                    ->render();
                break;

            case 'streak_milestone':
                $days = htmlspecialchars((string) ($data['days'] ?? $data['streak'] ?? '?'), ENT_QUOTES, 'UTF-8');
                $subject = __('emails.gamification_milestone.streak_subject', ['days' => $days]);
                $body = EmailTemplateBuilder::make()
                    ->theme('achievement')
                    ->title(__('emails.gamification_milestone.streak_title') . " \u{1F525}")
                    ->previewText(__('emails.gamification_milestone.streak_preview', ['days' => $days]))
                    ->greeting($name)
                    ->statCards([
                        ['value' => (string) $days, 'label' => __('emails.gamification_milestone.streak_label'), 'icon' => "\u{1F525}"],
                    ])
                    ->paragraph(__('emails.gamification_milestone.streak_body'))
                    ->button(__('emails.gamification_milestone.continue_streak'), EmailTemplateBuilder::tenantUrl('/feed'))
                    ->render();
                break;

            case 'leaderboard_top':
                $position = htmlspecialchars((string) ($data['position'] ?? $data['rank'] ?? '?'), ENT_QUOTES, 'UTF-8');
                $subject = __('emails.gamification_milestone.leaderboard_subject', ['position' => $position]);
                $body = EmailTemplateBuilder::make()
                    ->theme('achievement')
                    ->title(__('emails.gamification_milestone.leaderboard_title') . " \u{1F4CA}")
                    ->previewText(__('emails.gamification_milestone.leaderboard_preview', ['position' => $position]))
                    ->greeting($name)
                    ->statCards([
                        ['value' => '#' . $position, 'label' => __('emails.gamification_milestone.leaderboard_label'), 'icon' => "\u{1F4CA}"],
                    ])
                    ->paragraph(__('emails.gamification_milestone.leaderboard_body'))
                    ->button(__('emails.gamification_digest.view_leaderboard'), EmailTemplateBuilder::tenantUrl('/leaderboard'))
                    ->render();
                break;

            default:
                $subject = __('emails.gamification_milestone.default_subject');
                $message = !empty($data['message'])
                    ? htmlspecialchars($data['message'], ENT_QUOTES, 'UTF-8')
                    : __('emails.gamification_milestone.default_body');
                $body = EmailTemplateBuilder::make()
                    ->theme('achievement')
                    ->title(__('emails.gamification_milestone.default_title') . " \u{1F3C6}")
                    ->greeting($name)
                    ->highlight($message, "\u{1F3C6}")
                    ->button(__('emails.gamification_milestone.view_profile'), EmailTemplateBuilder::tenantUrl('/profile'))
                    ->render();
                break;
        }

        return [$subject, $body];
    }
}
