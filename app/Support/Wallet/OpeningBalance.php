<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Wallet;

/**
 * The ledger entry that carries a member's balance in from another timebank
 * (admin member import). Written with sender_id = 0, like starting_balance.
 *
 * The stored description is English and machine-readable; members see the
 * translated label WalletService substitutes for it.
 */
final class OpeningBalance
{
    public const TYPE = 'opening_balance';

    public static function describe(string $importRef, ?int $originalCents): string
    {
        $text = 'Opening balance carried over from previous timebank (import ' . $importRef;
        if ($originalCents !== null) {
            $text .= '; previous balance ' . self::formatCents($originalCents);
        }

        return $text . ')';
    }

    /** The negative balance the member had before, when it was imported as 0. */
    public static function originalCentsFrom(?string $description): ?int
    {
        if ($description === null || !preg_match('/; previous balance (-?)(\d+)\.(\d{2})\)$/', $description, $m)) {
            return null;
        }
        $cents = ((int) $m[2]) * 100 + (int) $m[3];

        return $m[1] === '-' ? -$cents : $cents;
    }

    public static function formatCents(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $abs = abs($cents);

        return sprintf('%s%d.%02d', $sign, intdiv($abs, 100), $abs % 100);
    }
}
