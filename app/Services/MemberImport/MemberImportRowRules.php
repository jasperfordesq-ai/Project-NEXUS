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
        foreach (MemberImportFile::COLUMNS as $column) {
            $value[$column] = self::clean((string) ($cells[$column] ?? ''));
            if (preg_match('/[\x00-\x1F\x7F]/', $value[$column])) {
                $problems[] = self::issue($column, 'control_characters');
            }
        }

        foreach (['first_name', 'last_name'] as $column) {
            if ($value[$column] === '') {
                $problems[] = self::issue($column, 'required');
            } elseif (mb_strlen($value[$column]) > 100) {
                $problems[] = self::issue($column, 'too_long', ['max' => 100]);
            } elseif (self::startsWithFormula($value[$column])) {
                $problems[] = self::issue($column, 'starts_with_formula_character');
            }
        }

        $email = mb_strtolower($value['email']);
        if ($email === '') {
            $problems[] = self::issue('email', 'required');
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
        if ($phone !== '' && (mb_strlen($phone) > 50 || !Validator::isPhone($phone))) {
            $problems[] = self::issue('phone', 'invalid_phone');
        }

        $location = $value['location'];
        if (mb_strlen($location) > 255) {
            $problems[] = self::issue('location', 'too_long', ['max' => 255]);
        } elseif (self::startsWithFormula($location)) {
            $problems[] = self::issue('location', 'starts_with_formula_character');
        }

        $balanceCents = 0;
        $originalCents = null;
        $balance = $value['balance'];
        if ($balance !== '') {
            if (!preg_match('/^(-)?(\d{1,6})(?:[.,](\d{1,2}))?$/', $balance, $m)) {
                $problems[] = self::issue('balance', 'invalid_number');
            } else {
                // "12,5" means 12.50 — a single decimal digit is tenths, so pad on the right.
                $cents = ((int) $m[2]) * 100 + (int) str_pad($m[3] ?? '', 2, '0');
                if ($cents > self::MAX_BALANCE_CENTS) {
                    $problems[] = self::issue('balance', 'balance_too_large', ['max' => 100000]);
                } elseif ($m[1] === '-' && $cents > 0) {
                    $originalCents = -$cents;
                    $warnings[] = self::issue('balance', 'negative_balance_zeroed', ['original' => OpeningBalance::formatCents(-$cents)]);
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

    /** Trim (including non-breaking spaces) and undo our own export's formula escape. */
    private static function clean(string $value): string
    {
        $value = (string) preg_replace('/^[\s\x{00A0}\x{FEFF}]+|[\s\x{00A0}\x{FEFF}]+$/u', '', $value);

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
