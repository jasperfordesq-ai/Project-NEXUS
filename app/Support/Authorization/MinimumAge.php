<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * The platform's minimum age: Project NEXUS is for adults aged 18 and over
 * (owner decision 2026-09-25 — under-18 participation is removed, not
 * supervised).
 *
 * One predicate for every door: sign-in gates, the per-request authentication
 * middleware, and every place a date of birth can be written.
 *
 * 🔴 An ABSENT date of birth is an adult account. The platform does not collect
 * a date of birth at sign-up, so treating "unknown" as a minor would lock out
 * almost every member. Only a recorded, valid, past date that puts the member
 * under 18 today counts as under age. An unparseable or future date is bad data,
 * not evidence of a minor, and does not lock anyone out; writing such a value is
 * refused separately by {@see self::dateOfBirthError()}.
 */
final class MinimumAge
{
    public const YEARS = 18;

    /** Returned on sign-in and on authenticated requests by an under-18 account. */
    public const ACCOUNT_ERROR_CODE = 'ACCOUNT_UNDER_MINIMUM_AGE';

    /** Returned when anyone tries to record a date of birth under 18. */
    public const DATE_OF_BIRTH_ERROR_CODE = 'DATE_OF_BIRTH_UNDER_MINIMUM_AGE';

    /** Returned when a date of birth is not a real past calendar date. */
    public const DATE_OF_BIRTH_INVALID_CODE = 'VALIDATION_INVALID_FORMAT';

    /** True only for a valid, past, recorded date of birth under 18 today. */
    public static function isUnder(mixed $dateOfBirth, ?DateTimeInterface $today = null): bool
    {
        $birthDate = self::parse($dateOfBirth);
        if ($birthDate === null) {
            return false;
        }
        $today = DateTimeImmutable::createFromInterface($today ?? new DateTimeImmutable('today'))->setTime(0, 0);
        if ($birthDate > $today) {
            return false;
        }

        return $today->diff($birthDate)->y < self::YEARS;
    }

    /**
     * Whether a user row/model/array belongs to an under-18 account.
     *
     * When the caller's row does not carry `date_of_birth` (several sign-in
     * paths select a narrow column list), it is read from the users table so a
     * narrow SELECT can never silently skip the check.
     *
     * @param object|array<string,mixed>|null $user
     */
    public static function userIsUnder(object|array|null $user): bool
    {
        if ($user === null) {
            return false;
        }
        $hasColumn = is_array($user)
            ? array_key_exists('date_of_birth', $user)
            : (method_exists($user, 'getAttributes')
                ? array_key_exists('date_of_birth', (array) $user->getAttributes())
                : property_exists($user, 'date_of_birth'));

        if ($hasColumn) {
            $dob = is_array($user)
                ? $user['date_of_birth']
                : (method_exists($user, 'getRawOriginal') && $user->getRawOriginal('date_of_birth') !== null
                    ? $user->getRawOriginal('date_of_birth')
                    : data_get($user, 'date_of_birth'));

            return self::isUnder($dob);
        }

        $id = (int) data_get($user, 'id', 0);
        $tenantId = (int) data_get($user, 'tenant_id', 0);
        if ($id <= 0) {
            return false;
        }
        $query = DB::table('users')->where('id', $id);
        if ($tenantId > 0) {
            $query->where('tenant_id', $tenantId);
        }

        return self::isUnder($query->value('date_of_birth'));
    }

    /**
     * Validate a date of birth someone is about to record.
     *
     * Returns null when the value may be stored, otherwise an error array in the
     * API error shape ({code, message, field}). Re-sending the value that is
     * already on the account is always accepted — profile forms post the whole
     * profile — so pass the stored value as $current.
     *
     * @return array{code:string,message:string,field:string}|null
     */
    public static function dateOfBirthError(mixed $new, mixed $current = null): ?array
    {
        if ($new === null || (is_string($new) && trim($new) === '')) {
            return null;
        }
        $parsed = self::parse($new);
        $currentParsed = self::parse($current);
        if ($parsed !== null && $currentParsed !== null
            && $parsed->format('Y-m-d') === $currentParsed->format('Y-m-d')) {
            return null;
        }
        if ($parsed === null || $parsed > new DateTimeImmutable('today')) {
            return [
                'code' => self::DATE_OF_BIRTH_INVALID_CODE,
                'message' => __('api_controllers_2.identity.dob_invalid'),
                'field' => 'date_of_birth',
            ];
        }
        if (self::isUnder($parsed->format('Y-m-d'))) {
            return [
                'code' => self::DATE_OF_BIRTH_ERROR_CODE,
                'message' => __('api.date_of_birth_under_minimum_age', ['age' => self::YEARS]),
                'field' => 'date_of_birth',
            ];
        }

        return null;
    }

    /** Normalise an accepted date-of-birth value to Y-m-d (callers store this). */
    public static function normalise(mixed $value): ?string
    {
        return self::parse($value)?->format('Y-m-d');
    }

    /** @return array{code:string,message:string} */
    public static function accountRefusal(): array
    {
        return [
            'code' => self::ACCOUNT_ERROR_CODE,
            'message' => __('api.account_under_minimum_age', ['age' => self::YEARS]),
        ];
    }

    private static function parse(mixed $value): ?DateTimeImmutable
    {
        if ($value instanceof DateTimeInterface) {
            return DateTimeImmutable::createFromInterface($value)->setTime(0, 0);
        }
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        // Accept a plain date or an ISO timestamp whose date part is a real date.
        if (preg_match('/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/', $value, $match) !== 1) {
            return null;
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $match[1]);
        $errors = DateTimeImmutable::getLastErrors();
        if ($date === false
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('Y-m-d') !== $match[1]) {
            return null;
        }

        return $date;
    }
}
