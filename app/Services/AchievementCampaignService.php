<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\AchievementCampaign;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AchievementCampaignService — Eloquent-based service for achievement campaigns.
 *
 * Stores and schedules campaigns. All queries are tenant-scoped via
 * HasTenantScope trait on the model.
 *
 * 🔴 THIS SERVICE AWARDS NOTHING. Read this before trusting the admin screens.
 *
 * The docblock here used to read "Manages campaigns that award badges, XP, or
 * trigger challenges for targeted user groups", which is not true of any
 * campaign type. Established 2026-08-28 by reading every method: there is no
 * award path at all. `createCampaign`/`updateCampaign` persist rows,
 * `activateCampaign` flips `status` to 'running', and
 * `processRecurringCampaigns` bumps `last_run_at` and logs
 * "(award logic stubbed)". No badge is granted, no XP is added, and
 * `total_awards` is never incremented — for one-time, recurring OR triggered.
 *
 * What that means for a community: an admin can open
 * /admin/gamification/campaigns, build a campaign, choose an audience, pick a
 * daily/weekly/monthly schedule, activate it, and watch it sit at "running"
 * indefinitely while no member ever receives anything. Nothing in the UI says
 * so.
 *
 * Finishing it is a product decision, not a rename, and is deliberately NOT
 * guessed at here. `achievement_campaigns` already models the WHAT
 * (`badge_key`, `xp_amount`, `target_audience`, `audience_config`), so the open
 * questions are behavioural: whether a missed run catches up or is skipped,
 * whether a recurring bonus may award the same member twice, and how
 * `total_awards` reconciles against the XP ledger. Awarding XP wrongly is hard
 * to reverse once leaderboards have moved, which is why this stays stopped
 * rather than half-wired.
 */
class AchievementCampaignService
{
    /**
     * Campaign types.
     */
    public const TYPES = [
        'one_time' => 'one_time',
        'recurring' => 'recurring',
        'triggered' => 'triggered',
    ];

    /**
     * Target audience options.
     */
    public const AUDIENCES = [
        'all_users' => 'all_users',
        'new_users' => 'new_users',
        'active_users' => 'active_users',
        'inactive_users' => 'inactive_users',
        'level_range' => 'level_range',
        'badge_holders' => 'badge_holders',
        'custom' => 'custom',
    ];

    private static array $typeToDbMap = [
        'one_time' => 'badge_award',
        'recurring' => 'xp_bonus',
        'triggered' => 'challenge',
    ];

    private static array $dbToTypeMap = [
        'badge_award' => 'one_time',
        'xp_bonus' => 'recurring',
        'challenge' => 'triggered',
    ];

    /**
     * Get all campaigns.
     */
    public function getCampaigns(?string $status = null): array
    {
        $query = AchievementCampaign::query()->orderByDesc('created_at');

        if ($status) {
            $query->where('status', $status);
        }

        $campaigns = $query->get()->map(function ($c) {
            $arr = $c->toArray();
            $arr['type'] = self::$dbToTypeMap[$arr['campaign_type'] ?? 'badge_award'] ?? 'one_time';
            return $arr;
        })->all();

        return $campaigns;
    }

    /**
     * Get a single campaign.
     */
    public function getCampaign(int $id): ?array
    {
        $campaign = AchievementCampaign::find($id);
        if (!$campaign) {
            return null;
        }

        $arr = $campaign->toArray();
        $arr['type'] = self::$dbToTypeMap[$arr['campaign_type'] ?? 'badge_award'] ?? 'one_time';
        return $arr;
    }

    /**
     * Create a new campaign.
     *
     * @return int|string|null Campaign ID
     */
    public function createCampaign(array $data): int|string|null
    {
        $campaignType = self::$typeToDbMap[$data['type'] ?? 'one_time'] ?? 'badge_award';

        try {
            $campaign = AchievementCampaign::create([
                'name' => $data['name'],
                'description' => $data['description'] ?? '',
                'campaign_type' => $campaignType,
                'badge_key' => $data['badge_key'] ?: null,
                'xp_amount' => $data['xp_amount'] ?? 0,
                'target_audience' => $data['target_audience'] ?? 'all_users',
                'audience_config' => $data['audience_config'] ?? [],
                'schedule' => $data['schedule'] ?? null,
                'status' => 'draft',
            ]);

            return $campaign->id;
        } catch (\Throwable $e) {
            Log::error('Achievement campaign creation failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Update a campaign.
     */
    public function updateCampaign(int $id, array $data): void
    {
        $campaignType = self::$typeToDbMap[$data['type'] ?? 'one_time'] ?? 'badge_award';

        AchievementCampaign::where('id', $id)->update([
            'name' => $data['name'],
            'description' => $data['description'] ?? '',
            'campaign_type' => $campaignType,
            'badge_key' => $data['badge_key'] ?: null,
            'xp_amount' => $data['xp_amount'] ?? 0,
            'target_audience' => $data['target_audience'] ?? 'all_users',
            'audience_config' => is_array($data['audience_config'] ?? null)
                ? json_encode($data['audience_config']) : ($data['audience_config'] ?? '{}'),
            'schedule' => $data['schedule'] ?? null,
        ]);
    }

    /**
     * Activate a campaign.
     */
    public function activateCampaign(int $id): void
    {
        AchievementCampaign::where('id', $id)->update([
            'status' => 'active',
            'activated_at' => now(),
        ]);
    }

    /**
     * Pause a campaign.
     */
    public function pauseCampaign(int $id): void
    {
        AchievementCampaign::where('id', $id)->update([
            'status' => 'paused',
        ]);
    }

    /**
     * Delete a campaign.
     */
    public function deleteCampaign(int $id): void
    {
        AchievementCampaign::where('id', $id)->delete();
    }

    /**
     * Cron: process recurring campaigns for the current tenant.
     *
     * Scans `achievement_campaigns` where:
     *   - status = 'running'
     *   - campaign_type = 'xp_bonus' (the DB enum value for "recurring",
     *     per self::$typeToDbMap)
     *   - last_run_at is null OR older than the recurrence_pattern window
     *
     * Each eligible campaign just bumps `last_run_at` for now — the actual
     * award logic (selecting users matching `target_audience` /
     * `audience_config` and awarding the badge or XP) is intentionally
     * stubbed here. Wiring real award delivery requires careful tenant-
     * scoped user-selection logic and a clear product decision on what
     * "missed runs" should do (catch up vs skip). Until that ships, the
     * cron entry stops throwing "undefined method" once per hour per
     * tenant; it logs activity so we can see when this stub fires.
     *
     * Returns the number of campaigns that were marked as run this tick.
     */
    public function processRecurringCampaigns(): array
    {
        $tenantId = TenantContext::getId();
        if ($tenantId === null) {
            return ['processed' => 0, 'awarded' => 0];
        }

        $now = now();
        $eligibility = function ($pattern, $lastRun) use ($now) {
            if ($lastRun === null) {
                return true;
            }
            $last = strtotime((string) $lastRun);
            $sec  = $now->timestamp - $last;
            return match (strtolower((string) $pattern)) {
                'daily'   => $sec >= 86400,
                'weekly'  => $sec >= 86400 * 7,
                'monthly' => $sec >= 86400 * 28,
                default   => $sec >= 86400 * 7,
            };
        };

        $rows = DB::table('achievement_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('status', 'running')
            ->where('campaign_type', 'xp_bonus')
            ->get();

        $processed = 0;
        foreach ($rows as $r) {
            if (!$eligibility($r->recurrence_pattern ?? 'weekly', $r->last_run_at ?? null)) {
                continue;
            }
            try {
                DB::table('achievement_campaigns')
                    ->where('id', $r->id)
                    ->update([
                        'last_run_at' => $now,
                    ]);
                Log::info('AchievementCampaignService: recurring tick (award logic stubbed)', [
                    'tenant_id'    => $tenantId,
                    'campaign_id'  => $r->id,
                    'name'         => $r->name,
                    'pattern'      => $r->recurrence_pattern,
                ]);
                $processed++;
            } catch (\Throwable $e) {
                Log::warning('AchievementCampaignService::processRecurringCampaigns failed', [
                    'campaign_id' => $r->id,
                    'error'       => $e->getMessage(),
                ]);
            }
        }

        // Return shape matches the original cron caller expectation
        // (an iterable of per-campaign results with `awarded` count).
        return array_map(fn () => ['awarded' => 0], range(1, $processed));
    }
}
