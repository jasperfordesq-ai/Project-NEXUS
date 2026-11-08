<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Services\RedisCache;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A community's own OpenAI key, saved in Admin › AI settings, and whether
 * OpenAI has recently refused it.
 *
 * Owner decision, 8 Nov 2026: API keys are per community. The member-facing
 * AI writing helpers that go through {@see \App\Services\AiChatService::chat()}
 * use this key only — never the platform key (OPENAI_API_KEY).
 *
 * When OpenAI refuses the key outright (wrong key, or no credit left on the
 * account) the refusal is recorded, and the "Generate description" buttons are
 * hidden for {@see self::REFUSAL_HOLD_HOURS} hours or until an administrator
 * saves a key again, whichever comes first ({@see AiDescriptionAvailability}).
 * A passing rate limit is not recorded: it says nothing about the key.
 *
 * The key itself is never logged.
 */
final class CommunityOpenAiKey
{
    public const KEY_SETTING = 'openai_api_key';
    public const REFUSED_AT_SETTING = 'openai_key_refused_at';
    public const REFUSED_REASON_SETTING = 'openai_key_refused_reason';
    public const REFUSAL_HOLD_HOURS = 24;

    public const REASON_INVALID_KEY = 'invalid_key';
    public const REASON_NO_CREDIT = 'no_credit';

    /** The community's own key, or null when none (or only spaces) is saved. */
    public static function get(?int $tenantId = null): ?string
    {
        $tenantId ??= (int) (TenantContext::getId() ?? 0);
        if ($tenantId <= 0) {
            return null;
        }

        $key = trim((string) AiSettings::get($tenantId, self::KEY_SETTING));

        return $key === '' ? null : $key;
    }

    /**
     * Which refusal, if any, means the key itself cannot be used.
     *
     * 401 is OpenAI rejecting the key. 429 with `insufficient_quota` is an
     * account with no credit. Any other failure (a passing rate limit, an
     * outage) is not held against the key.
     */
    public static function refusalReason(int $status, mixed $providerErrorCode): ?string
    {
        if ($status === 401) {
            return self::REASON_INVALID_KEY;
        }
        if ($status === 429 && $providerErrorCode === 'insufficient_quota') {
            return self::REASON_NO_CREDIT;
        }

        return null;
    }

    public static function recordRefusal(int $tenantId, string $reason): void
    {
        if ($tenantId <= 0) {
            return;
        }

        AiSettings::setMultiple($tenantId, [
            self::REFUSED_AT_SETTING => now()->toDateTimeString(),
            self::REFUSED_REASON_SETTING => $reason,
        ]);
        self::forgetBootstrap($tenantId);

        Log::warning('Community OpenAI key refused; AI description buttons hidden', [
            'tenant_id' => $tenantId,
            'reason' => $reason,
            'hold_hours' => self::REFUSAL_HOLD_HOURS,
        ]);
    }

    public static function clearRefusal(int $tenantId): void
    {
        DB::table('ai_settings')
            ->where('tenant_id', $tenantId)
            ->whereIn('setting_key', [self::REFUSED_AT_SETTING, self::REFUSED_REASON_SETTING])
            ->delete();
        self::forgetBootstrap($tenantId);
    }

    /** True while a recorded refusal is less than REFUSAL_HOLD_HOURS old. */
    public static function recentlyRefused(int $tenantId): bool
    {
        $at = AiSettings::get($tenantId, self::REFUSED_AT_SETTING);
        if (!is_string($at) || trim($at) === '') {
            return false;
        }

        try {
            return Carbon::parse($at)->gt(now()->subHours(self::REFUSAL_HOLD_HOURS));
        } catch (\Throwable) {
            // An unreadable timestamp cannot prove the key works.
            return true;
        }
    }

    /** The apps learn which buttons to show from the cached bootstrap. */
    private static function forgetBootstrap(int $tenantId): void
    {
        try {
            app(RedisCache::class)->delete('tenant_bootstrap', $tenantId);
        } catch (\Throwable $e) {
            Log::warning('CommunityOpenAiKey: could not clear the bootstrap cache', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
