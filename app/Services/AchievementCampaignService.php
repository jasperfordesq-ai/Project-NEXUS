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
 * Stores, schedules AND delivers campaigns. All queries are tenant-scoped via
 * the HasTenantScope trait on the model.
 *
 * 🔴 History worth knowing, because it was invisible for months. Until
 * 2026-08-28 this service awarded nothing — for ANY campaign type. Rows were
 * persisted and `processRecurringCampaigns()` bumped `last_run_at` and logged
 * "(award logic stubbed)"; no badge was granted, no XP added, `total_awards`
 * never moved. An admin could build a campaign, choose an audience, pick a
 * schedule, activate it, and watch it sit there for ever while no member
 * received anything, with nothing in the UI saying so.
 *
 * Two separate faults had to be fixed to make it work, and the second is the
 * one that would have made a half-fix look successful:
 *
 *  - No delivery. `deliverCampaign()` and `eachAudienceMember()` below now
 *    resolve the audience and award through `GamificationService`, which
 *    already handles the ledger, notifications in the recipient's own language,
 *    level-ups and realtime broadcast. Nothing about awarding is reimplemented
 *    here.
 *  - No campaign could ever be ELIGIBLE. `activateCampaign()` wrote
 *    `status = 'active'`, which is not in the column's enum, while the cron
 *    selected `status = 'running'`. See `$statusToDbMap`.
 *
 * The two behavioural rules — a missed run is skipped rather than caught up,
 * and one award per member per period enforced by a unique key rather than by
 * application logic — are documented on `processRecurringCampaigns()`.
 *
 * 🔴 `challenge` campaigns are still deliberately NOT delivered on a timer: a
 * challenge is something a member opts into, so handing it out on a schedule
 * would award members who never took part. `deliverCampaign()` returns 0 for
 * them by design, not by omission.
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
     * The admin UI's status vocabulary, mapped to the column's enum.
     *
     * 🔴 The UI has always sent 'active', which the enum does not contain —
     * 'running' is its word for the live state. Writing 'active' silently
     * coerced to '' on a non-strict connection, and since the cron selects
     * `status = 'running'`, no campaign an admin activated was EVER eligible.
     * Deliberately not "fixed" by adding 'active' to the enum: two spellings of
     * one state is how this started.
     */
    private static array $statusToDbMap = [
        'draft' => 'draft',
        'active' => 'running',
        'paused' => 'paused',
        'completed' => 'completed',
        'cancelled' => 'cancelled',
    ];

    private static array $dbToStatusMap = [
        'draft' => 'draft',
        'scheduled' => 'draft',
        'running' => 'active',
        'paused' => 'paused',
        'completed' => 'completed',
        'cancelled' => 'cancelled',
    ];

    /** The XP-ledger action every campaign bonus is written under. */
    public const XP_ACTION = 'campaign_award';

    /** Members awarded per query page, so a large community cannot exhaust memory. */
    private const AUDIENCE_CHUNK = 500;

    public static function presentStatus(?string $dbStatus): string
    {
        return self::$dbToStatusMap[(string) $dbStatus] ?? 'draft';
    }

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
            // The admin UI's Select offers draft/active/paused, so hand back its
            // own vocabulary rather than the column's — otherwise a running
            // campaign matches no option and the control renders blank.
            $arr['status'] = self::presentStatus($arr['status'] ?? 'draft');
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
        $arr['status'] = self::presentStatus($arr['status'] ?? 'draft');
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
            // 'running', not 'active' — see $statusToDbMap. Writing 'active'
            // put the row outside its own enum and made it invisible to cron.
            'status' => self::$statusToDbMap['active'],
            'activated_at' => now(),
        ]);
    }

    /**
     * Pause a campaign.
     */
    public function pauseCampaign(int $id): void
    {
        // 'paused' is a real enum value as of the 2026-08-28 migration. It is
        // distinct from 'draft': activated_at must survive a pause.
        AchievementCampaign::where('id', $id)->update([
            'status' => self::$statusToDbMap['paused'],
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
     * Cron: deliver every live campaign that is due, for the current tenant.
     *
     * Selects `status = 'running'` campaigns whose recurrence window has
     * elapsed, resolves each one's audience, and awards the badge or XP.
     *
     * 🔴 The two behavioural rules, decided 2026-08-28 and enforced below.
     *
     * 1. A MISSED RUN IS SKIPPED, NEVER CAUGHT UP. The period key comes from
     *    the clock now, not from counting windows since `last_run_at`. If cron
     *    was down for a month, a weekly bonus pays once, not four times.
     *    Catching up would hand out a lump of XP that reorders the leaderboard
     *    for something no member did, and XP cannot be taken back without
     *    rewriting history a member has already seen.
     *
     * 2. ONE AWARD PER MEMBER PER PERIOD, enforced by the DATABASE, not by
     *    this loop. Every XP award is written with
     *    `source_reference = campaign:<id>:<period>` and
     *    `uniq_user_xp_log_ref (tenant_id, user_id, action, source_reference)`
     *    rejects the second one, which `GamificationService::awardXP()` already
     *    swallows as an idempotent no-op. So a cron overlap, a retry, or two
     *    workers racing cannot double-pay. Badges are inherently once-only —
     *    `awardBadge()` returns early if the member holds it.
     *
     * `last_run_at` is stamped only AFTER delivery, so a crash mid-run leaves
     * the campaign due again and the unique key makes the retry safe.
     *
     * @return list<array{campaign_id: int, awarded: int}> one entry per campaign
     *         actually run — the shape CronJobRunner sums.
     */
    public function processRecurringCampaigns(): array
    {
        $tenantId = TenantContext::getId();
        if ($tenantId === null) {
            return [];
        }

        $now = now();

        $rows = DB::table('achievement_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('status', self::$statusToDbMap['active'])
            ->get();

        $results = [];
        foreach ($rows as $campaign) {
            $pattern = $this->recurrencePatternFor($campaign);

            if (! $this->isDue($pattern, $campaign->last_run_at ?? null, $now)) {
                continue;
            }

            try {
                $awarded = $this->deliverCampaign($campaign, $tenantId, $this->periodKey($pattern, $now));

                DB::table('achievement_campaigns')
                    ->where('id', $campaign->id)
                    ->update(array_filter([
                        'last_run_at' => $now,
                        'executed_at' => $now,
                        // A one-off campaign is finished once it has run. Left
                        // 'running' it would re-scan for ever, and every new
                        // member joining afterwards would silently qualify.
                        'status' => $pattern === 'once' ? 'completed' : null,
                    ], static fn ($v) => $v !== null));

                if ($awarded > 0) {
                    DB::table('achievement_campaigns')
                        ->where('id', $campaign->id)
                        ->increment('total_awards', $awarded);
                }

                Log::info('AchievementCampaignService: campaign delivered', [
                    'tenant_id' => $tenantId,
                    'campaign_id' => (int) $campaign->id,
                    'name' => $campaign->name,
                    'pattern' => $pattern,
                    'awarded' => $awarded,
                ]);

                $results[] = ['campaign_id' => (int) $campaign->id, 'awarded' => $awarded];
            } catch (\Throwable $e) {
                // Deliberately NOT stamping last_run_at here: an unstamped
                // campaign is retried next tick, and the unique key makes the
                // members already paid a no-op.
                Log::error('AchievementCampaignService: campaign delivery failed', [
                    'tenant_id' => $tenantId,
                    'campaign_id' => (int) $campaign->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $results;
    }

    /**
     * The recurrence window for a campaign.
     *
     * `recurrence_pattern` is the column the scheduler reads, but the admin
     * form posts its choice into `schedule`, so a UI-created campaign has
     * `recurrence_pattern` NULL. Read both rather than silently treating a
     * daily campaign as weekly. A one-off campaign has no window at all.
     */
    private function recurrencePatternFor(object $campaign): string
    {
        if (($campaign->campaign_type ?? '') === 'badge_award') {
            return 'once';
        }

        $pattern = strtolower(trim((string) ($campaign->recurrence_pattern ?? $campaign->schedule ?? '')));

        return in_array($pattern, ['daily', 'weekly', 'monthly'], true) ? $pattern : 'weekly';
    }

    private function isDue(string $pattern, ?string $lastRun, \DateTimeInterface $now): bool
    {
        if ($lastRun === null) {
            return true;
        }

        // A one-off that has already run is never due again; the status change
        // to 'completed' is the real guard, this is the belt to its braces.
        if ($pattern === 'once') {
            return false;
        }

        $elapsed = $now->getTimestamp() - strtotime($lastRun);

        return match ($pattern) {
            'daily' => $elapsed >= 86400,
            'monthly' => $elapsed >= 86400 * 28,
            default => $elapsed >= 86400 * 7,
        };
    }

    /**
     * The bucket a member may be paid at most once for.
     *
     * Derived from the clock, which is what makes a missed run a skip rather
     * than a debt: the run that eventually happens claims the CURRENT period,
     * never the ones that were missed.
     */
    private function periodKey(string $pattern, \DateTimeInterface $now): string
    {
        return match ($pattern) {
            'once' => 'once',
            'daily' => $now->format('Y-m-d'),
            'monthly' => $now->format('Y-m'),
            default => $now->format('o-\WW'),
        };
    }

    /**
     * Award one campaign to its audience. Returns the number of members paid.
     */
    private function deliverCampaign(object $campaign, int $tenantId, string $periodKey): int
    {
        $type = (string) ($campaign->campaign_type ?? '');

        // 'challenge' campaigns describe a challenge a member opts into; there
        // is nothing to hand out on a timer, and inventing one would award
        // members who never took part. Left explicitly undelivered.
        if (! in_array($type, ['badge_award', 'xp_bonus'], true)) {
            return 0;
        }

        $badgeKey = trim((string) ($campaign->badge_key ?? ''));
        $xpAmount = (int) ($campaign->xp_amount ?? 0);

        if ($type === 'badge_award' && $badgeKey === '') {
            Log::warning('AchievementCampaignService: badge campaign has no badge_key', [
                'campaign_id' => (int) $campaign->id,
            ]);
            return 0;
        }
        if ($type === 'xp_bonus' && $xpAmount <= 0) {
            Log::warning('AchievementCampaignService: xp campaign has no positive xp_amount', [
                'campaign_id' => (int) $campaign->id,
            ]);
            return 0;
        }

        $reference = 'campaign:' . (int) $campaign->id . ':' . $periodKey;
        $description = trim((string) ($campaign->name ?? 'Campaign'));
        $awarded = 0;

        $this->eachAudienceMember($campaign, $tenantId, function (int $userId) use (
            $type, $badgeKey, $xpAmount, $reference, $description, &$awarded
        ): void {
            if ($type === 'badge_award') {
                GamificationService::awardBadgeByKey($userId, $badgeKey);
            } else {
                GamificationService::awardXP($userId, $xpAmount, self::XP_ACTION, $description, $reference);
            }
            $awarded++;
        });

        return $awarded;
    }

    /**
     * Resolve the campaign's audience and hand each member to $callback.
     *
     * Always tenant-scoped, always limited to members who can actually receive
     * something (active and approved) — a suspended or pending account must not
     * accrue credit — and always chunked, so a large community cannot pull tens
     * of thousands of rows into memory in one cron tick.
     */
    private function eachAudienceMember(object $campaign, int $tenantId, callable $callback): void
    {
        $config = $campaign->audience_config ?? null;
        if (is_string($config)) {
            $config = json_decode($config, true);
        }
        $config = is_array($config) ? $config : [];

        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('is_approved', 1);

        $days = static function (array $c, int $default): int {
            $d = (int) ($c['days'] ?? $default);
            return $d > 0 ? $d : $default;
        };

        switch ((string) ($campaign->target_audience ?? 'all_users')) {
            case 'new_users':
                $query->where('created_at', '>=', now()->subDays($days($config, 30)));
                break;

            case 'active_users':
                $query->where('last_active_at', '>=', now()->subDays($days($config, 30)));
                break;

            case 'inactive_users':
                // "Never active" counts as inactive; a NULL comparison would
                // quietly drop exactly the members such a campaign targets.
                $cutoff = now()->subDays($days($config, 30));
                $query->where(function ($q) use ($cutoff) {
                    $q->whereNull('last_active_at')->orWhere('last_active_at', '<', $cutoff);
                });
                break;

            case 'level_range':
                $min = (int) ($config['min_level'] ?? 1);
                $max = (int) ($config['max_level'] ?? 0);
                $query->where('level', '>=', $min);
                if ($max >= $min && $max > 0) {
                    $query->where('level', '<=', $max);
                }
                break;

            case 'badge_holders':
                $holderBadge = trim((string) ($config['badge_key'] ?? ''));
                if ($holderBadge === '') {
                    return; // an unconfigured filter must select nobody, not everybody
                }
                $query->whereIn('id', function ($sub) use ($holderBadge, $tenantId) {
                    $sub->select('user_id')
                        ->from('user_badges')
                        ->where('tenant_id', $tenantId)
                        ->where('badge_key', $holderBadge);
                });
                break;

            case 'custom':
                $ids = array_values(array_filter(array_map(
                    'intval',
                    is_array($config['user_ids'] ?? null) ? $config['user_ids'] : [],
                )));
                if ($ids === []) {
                    return;
                }
                $query->whereIn('id', $ids);
                break;

            case 'all_users':
            default:
                break;
        }

        $query->select('id')
            ->orderBy('id')
            ->chunkById(self::AUDIENCE_CHUNK, static function ($members) use ($callback) {
                foreach ($members as $member) {
                    $callback((int) $member->id);
                }
            });
    }
}
