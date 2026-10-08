<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Core\Validator;
use App\Services\DisposableEmailService;
use App\Support\Wallet\OpeningBalance;

/**
 * The rules for one row of a member import. Used by the check AND again by
 * the writer at the moment a member is created, so the two can never differ.
 * Same limits as self-registration (RegistrationService): names ≤100, email
 * ≤255 and not disposable, international phone numbers.
 *
 * Problem codes (the row is refused): required, too_long, invalid_encoding,
 * control_characters, starts_with_formula_character, invalid_email,
 * example_address, disposable_email, invalid_phone, invalid_number,
 * balance_too_large. Warning code: negative_balance_zeroed.
 */
final class MemberImportRowRules
{
    public const MAX_BALANCE_CENTS = 10_000_000; // 100,000 hours — the manual-adjustment cap

    public function __construct(private readonly DisposableEmailService $disposable)
    {
    }

    /**
     * @param array<string, string> $cells
     * @return array{row: array<string, mixed>|null, problems: list<array<string, mixed>>, warnings: list<array<string, mixed>>}
     */
    public function check(array $cells): array
    {
        $problems = [];
        $warnings = [];
        $value = [];
        $unreadable = []; // columns not in UTF-8: reported once, no other rule is run on them
        foreach (MemberImportFile::COLUMNS as $column) {
            $raw = (string) ($cells[$column] ?? '');
            if (!mb_check_encoding($raw, 'UTF-8')) {
                $problems[] = self::issue($column, 'invalid_encoding');
                $unreadable[$column] = true;
                $value[$column] = '';
                continue;
            }
            $value[$column] = self::clean($raw);
            if (preg_match('/[\x00-\x1F\x7F\x{0080}-\x{009F}]/u', $value[$column])) {
                $problems[] = self::issue($column, 'control_characters');
            }
        }

        foreach (['first_name', 'last_name'] as $column) {
            if (isset($unreadable[$column])) {
                continue;
            }
            if ($value[$column] === '') {
                $problems[] = self::issue($column, 'required');
            } elseif (mb_strlen($value[$column]) > 100) {
                $problems[] = self::issue($column, 'too_long', ['max' => 100]);
            } elseif (self::startsWithFormula($value[$column])) {
                $problems[] = self::issue($column, 'starts_with_formula_character');
            }
        }

        $email = mb_strtolower($value['email']);
        if (isset($unreadable['email'])) {
            // already reported
        } elseif ($email === '') {
            $problems[] = self::issue('email', 'required');
        } elseif (self::startsWithFormula($email)) {
            $problems[] = self::issue('email', 'starts_with_formula_character');
        } elseif (mb_strlen($email) > 255) {
            $problems[] = self::issue('email', 'too_long', ['max' => 255]);
        } elseif (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $problems[] = self::issue('email', 'invalid_email');
        } elseif (preg_match('/@(?:[^@]+\.)?example\.(?:com|org|net)$/', $email)) {
            $problems[] = self::issue('email', 'example_address');
        } elseif ($this->disposable->isDisposable($email)) {
            $problems[] = self::issue('email', 'disposable_email');
        }

        $phone = $value['phone'];
        // Every genuine international number starts with + or a digit, so a leading "-" is a mistake.
        if (!isset($unreadable['phone']) && $phone !== ''
            && (mb_strlen($phone) > 50 || $phone[0] === '-' || !Validator::isPhone($phone))) {
            $problems[] = self::issue('phone', 'invalid_phone');
        }

        $location = $value['location'];
        if (isset($unreadable['location'])) {
            // already reported
        } elseif (mb_strlen($location) > 255) {
            $problems[] = self::issue('location', 'too_long', ['max' => 255]);
        } elseif (self::startsWithFormula($location)) {
            $problems[] = self::issue('location', 'starts_with_formula_character');
        }

        $balanceCents = 0;
        $originalCents = null;
        $balance = $value['balance'];
        if ($balance !== '' && !isset($unreadable['balance'])) {
            if (!preg_match('/^(-)?(\d{1,6})(?:[.,](\d{1,2}))?$/', $balance, $m)) {
                $problems[] = self::issue('balance', 'invalid_number');
            } else {
                // "12,5" means 12.50 — a single decimal digit is tenths, so pad on the right.
                $cents = ((int) $m[2]) * 100 + (int) str_pad($m[3] ?? '', 2, '0');
                if ($m[1] === '-') {
                    // Negative balances start at 0 whatever their size; "-0" is just 0.
                    if ($cents > 0) {
                        $originalCents = -$cents;
                        $warnings[] = self::issue('balance', 'negative_balance_zeroed', ['original' => OpeningBalance::formatCents(-$cents)]);
                    }
                } elseif ($cents > self::MAX_BALANCE_CENTS) {
                    $problems[] = self::issue('balance', 'balance_too_large', ['max' => 100000]);
                } else {
                    $balanceCents = $cents;
                }
            }
        }

        if ($problems !== []) {
            return ['row' => null, 'problems' => $problems, 'warnings' => $warnings];
        }

        return [
            'row' => [
                'first_name' => $value['first_name'],
                'last_name' => $value['last_name'],
                'email' => $email,
                'phone' => $phone === '' ? null : $phone,
                'location' => $location === '' ? null : $location,
                'balance_cents' => $balanceCents,
                'original_balance_cents' => $originalCents,
            ],
            'problems' => [],
            'warnings' => $warnings,
        ];
    }

    /**
     * Trim whitespace, Unicode spaces (NBSP, ideographic space…) and invisible format
     * characters (zero-width space, BOM…), then undo our own export's formula escape.
     * Never blanks a value: if the pattern cannot run, the original comes back unchanged.
     */
    private static function clean(string $value): string
    {
        $trimmed = preg_replace('/^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/u', '', $value);
        $value = $trimmed ?? $value;

        return preg_match("/^'[=+\\-@]/", $value) ? substr($value, 1) : $value;
    }

    private static function startsWithFormula(string $value): bool
    {
        return $value !== '' && in_array($value[0], ['=', '+', '-', '@'], true);
    }

    /** @param array<string, int|string> $params @return array<string, mixed> */
    private static function issue(string $column, string $code, array $params = []): array
    {
        return ['column' => $column, 'code' => $code, 'params' => $params];
    }
}
