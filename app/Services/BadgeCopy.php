<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

/** Render built-in badge copy after cache lookup, in the current recipient/viewer locale. */
final class BadgeCopy
{
    public static function localize(array $badge): array
    {
        foreach (['name', 'description'] as $field) {
            $code = $badge[$field . '_code'] ?? null;
            // Null codes are intentional community overrides: never replace them.
            if (!is_string($code) || $code === '') {
                continue;
            }
            $key = 'badge_copy.' . $code;
            $translated = __($key);
            if (is_string($translated) && $translated !== $key) {
                $badge[$field] = $translated;
                if ($field === 'description') {
                    $badge['msg'] = $translated;
                }
            }
        }
        return $badge;
    }
}
