<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Translation;

use App\Services\TranslationConfigurationService;
use Illuminate\Support\Facades\DB;

/**
 * Whether posts, listings and other member content are translated
 * automatically for one member — the single place this rule lives.
 *
 * Owner decision, 7 Nov 2026: a community admin may switch automatic content
 * translation on for the whole community (translation.auto_translate_content,
 * off by default), and each member may still switch it off — or on — for
 * themselves.
 *
 *  - users.auto_translate_ugc_chosen_at IS NULL: the member never chose, so
 *    they follow their community's setting.
 *  - users.auto_translate_ugc_chosen_at set: users.auto_translate_ugc is the
 *    member's own choice and the community setting does not change it.
 *
 * The EFFECTIVE value is what every client receives as `auto_translate_ugc`,
 * so the website, the accessible website and the phone app need no change.
 */
final class MemberContentAutoTranslate
{
    public const CHOSEN_AT_COLUMN = 'auto_translate_ugc_chosen_at';

    /**
     * The effective value for a member of $tenantId, from the two stored columns.
     */
    public static function effective(mixed $storedValue, mixed $chosenAt, int $tenantId): bool
    {
        if ($chosenAt === null || $chosenAt === '') {
            return TranslationConfigurationService::contentAutoTranslateOn($tenantId);
        }

        return (bool) $storedValue;
    }

    /**
     * The user columns to write when a member of $tenantId saves $value.
     *
     * Saving the same value as the community records no choice, so the member
     * keeps following the community if an admin later changes it. Saving the
     * opposite value records the member's own choice.
     *
     * @return array{auto_translate_ugc: bool, auto_translate_ugc_chosen_at: \Illuminate\Support\Carbon|null}
     */
    public static function columnsForSave(bool $value, int $tenantId): array
    {
        $followsCommunity = $value === TranslationConfigurationService::contentAutoTranslateOn($tenantId);

        return [
            'auto_translate_ugc' => $value,
            self::CHOSEN_AT_COLUMN => $followsCommunity ? null : now(),
        ];
    }

    /**
     * The member's effective setting and target language, read from their row in
     * $tenantId only. Null when the member is not in that community.
     *
     * @return array{auto_translate_ugc: bool, auto_translate_target_locale: ?string}|null
     */
    public static function forMember(int $userId, int $tenantId): ?array
    {
        $row = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['auto_translate_ugc', self::CHOSEN_AT_COLUMN, 'auto_translate_target_locale', 'preferred_language'])
            ->first();

        if ($row === null) {
            return null;
        }

        return [
            'auto_translate_ugc' => self::effective($row->auto_translate_ugc, $row->{self::CHOSEN_AT_COLUMN}, $tenantId),
            'auto_translate_target_locale' => $row->auto_translate_target_locale ?? ($row->preferred_language ?? null),
        ];
    }
}
