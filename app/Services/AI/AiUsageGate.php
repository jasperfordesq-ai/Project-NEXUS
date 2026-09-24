<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\AI;

use App\Core\TenantContext;
use App\Models\AiUserLimit;
use Illuminate\Support\Facades\Log;

/**
 * AiUsageGate — the single admission check for member-triggered AI provider
 * calls outside the chat path (E-035 F-164).
 *
 * The chat path enforces the community's AI master switch and the member's
 * AI budget (F-044/F-048). Description generators, marketplace auto-reply,
 * message/federated/UGC translation and voice transcription called the
 * provider with neither, so member content kept reaching the provider after
 * an administrator switched AI off, and none of it counted against a budget.
 *
 * Call {@see admit()} immediately before the provider call. It:
 *   1. refuses when the community AI master switch is off
 *      ({@see AIServiceFactory::isEnabled()}), without touching the budget;
 *   2. otherwise reserves one slot atomically through
 *      {@see AiUserLimit::admitRequest()} — the same counter chat uses — and
 *      refuses when the daily or monthly allowance is spent.
 *
 * A refusal means the caller MUST NOT contact the provider.
 */
final class AiUsageGate
{
    public const REASON_AI_DISABLED = 'ai_disabled';
    public const REASON_NO_MEMBER = 'no_member';

    /**
     * Upper bound (characters) on a single member-supplied free-text field
     * that is interpolated into a provider prompt.
     */
    public const MAX_PROMPT_TEXT = 2000;

    /**
     * Reserve one AI provider attempt for a member.
     *
     * @return array{allowed: bool, reason: string|null, daily_used?: int, daily_limit?: int, daily_remaining?: int, monthly_used?: int, monthly_limit?: int, monthly_remaining?: int}
     */
    public static function admit(int $userId, ?int $tenantId = null): array
    {
        if (!self::aiEnabled()) {
            return ['allowed' => false, 'reason' => self::REASON_AI_DISABLED];
        }

        $tenantId ??= (int) (TenantContext::getId() ?? 0);
        if ($userId <= 0 || $tenantId <= 0) {
            return ['allowed' => false, 'reason' => self::REASON_NO_MEMBER];
        }

        return AiUserLimit::admitRequest($userId, $tenantId);
    }

    /**
     * Is the community AI master switch on? Fails closed if it cannot be read.
     */
    public static function aiEnabled(): bool
    {
        try {
            return AIServiceFactory::isEnabled();
        } catch (\Throwable $e) {
            Log::error('AiUsageGate: could not read the AI master switch; refusing AI use', [
                'tenant_id' => TenantContext::getId(),
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * Was this refusal caused by the AI master switch (rather than the budget)?
     *
     * @param array{allowed: bool, reason: string|null} $admission
     */
    public static function isDisabled(array $admission): bool
    {
        return in_array($admission['reason'] ?? null, [self::REASON_AI_DISABLED, self::REASON_NO_MEMBER], true);
    }

    /**
     * Bound a member-supplied free-text value before it is placed in a prompt.
     */
    public static function clip(string $text, int $max = self::MAX_PROMPT_TEXT): string
    {
        $text = trim($text);

        return mb_strlen($text) > $max ? mb_substr($text, 0, $max) : $text;
    }
}
