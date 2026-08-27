<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * The single source of truth for a user account's DISPLAY name.
 *
 * An account created through the general sign-up (or switched later in profile
 * settings) can be an ORGANISATION: `users.profile_type = 'organisation'` with
 * the trading name in `users.organization_name`. `first_name`/`last_name` then
 * hold the CONTACT PERSON, who must not be shown as the account's identity
 * anywhere a member can see.
 *
 * 🔴 Two spellings, both deliberate and neither safe to "tidy":
 *   - the VALUE is British:  profile_type = 'organisation'
 *   - the COLUMN is American: organization_name
 * Comparing against 'organization' silently never matches (that exact bug lived
 * in AiUserMemoryService). Use {@see self::ORGANISATION}.
 *
 * `users.name` is a REAL STORED COLUMN, not a computed alias, and is read by
 * more than a hundred call sites. It is kept in sync by the writers listed in
 * {@see self::forStorage()}'s callers plus a backfill migration; the
 * User::getNameAttribute() accessor is the defence-in-depth layer for rows that
 * predate that sync.
 */
final class UserDisplayName
{
    /** The `users.profile_type` value marking an organisation account. */
    public const ORGANISATION = 'organisation';

    /**
     * A SQL CASE expression yielding the display name.
     *
     * Use this instead of a bare `CONCAT(first_name, ' ', last_name)` in any
     * select whose result reaches a front end.
     *
     * @param string $alias Table alias/qualifier without the trailing dot
     *                      (e.g. 'u'), or '' for an unqualified query.
     * @param string $as    Result column name; pass '' to omit the alias
     *                      (e.g. when embedding in ORDER BY or a WHERE).
     */
    public static function sql(string $alias = '', string $as = 'name'): string
    {
        $p = $alias === '' ? '' : rtrim($alias, '.') . '.';

        $expr = "CASE
                WHEN {$p}profile_type = '" . self::ORGANISATION . "'
                     AND {$p}organization_name IS NOT NULL
                     AND {$p}organization_name != ''
                THEN {$p}organization_name
                ELSE TRIM(CONCAT(COALESCE({$p}first_name, ''), ' ', COALESCE({$p}last_name, '')))
            END";

        return $as === '' ? $expr : $expr . ' as ' . $as;
    }

    /**
     * Resolve the display name from a loaded row, model or array.
     *
     * Accepts anything with `profile_type` / `organization_name` /
     * `first_name` / `last_name` / `name` keys or properties. Missing keys are
     * treated as absent rather than empty, so a partial select degrades to the
     * best name it actually has instead of to an empty string.
     *
     * @param array<string, mixed>|object|null $user
     * @param string|null $fallback Returned when nothing usable is present.
     */
    public static function resolve(array|object|null $user, ?string $fallback = null): string
    {
        if ($user === null) {
            return (string) $fallback;
        }

        $get = static function (string $key) use ($user): ?string {
            if (is_array($user)) {
                return array_key_exists($key, $user) && $user[$key] !== null
                    ? (string) $user[$key]
                    : null;
            }

            // Eloquent models: read raw attributes so the `name` accessor cannot
            // recurse back into this helper.
            if ($user instanceof \Illuminate\Database\Eloquent\Model) {
                $attributes = $user->getAttributes();

                return array_key_exists($key, $attributes) && $attributes[$key] !== null
                    ? (string) $attributes[$key]
                    : null;
            }

            return isset($user->{$key}) ? (string) $user->{$key} : null;
        };

        return self::fromParts(
            $get('profile_type'),
            $get('organization_name'),
            $get('first_name'),
            $get('last_name'),
            $get('name'),
            $fallback,
        );
    }

    /**
     * Resolve a display name from PREFIXED columns on a joined row.
     *
     * Joins routinely alias a user's columns to distinguish the two ends of a
     * relationship -- `author_first_name`, `sender_last_name`,
     * `reviewer_organization_name`. Pass the prefix (including the trailing
     * underscore) and this reads the same four fields through it.
     *
     * @param array<string, mixed>|object|null $row
     */
    public static function resolvePrefixed(array|object|null $row, string $prefix, ?string $fallback = null): string
    {
        if ($row === null) {
            return (string) $fallback;
        }

        $get = static function (string $key) use ($row, $prefix): ?string {
            $field = $prefix . $key;

            if (is_array($row)) {
                return array_key_exists($field, $row) && $row[$field] !== null
                    ? (string) $row[$field]
                    : null;
            }

            if ($row instanceof \Illuminate\Database\Eloquent\Model) {
                $attributes = $row->getAttributes();

                return array_key_exists($field, $attributes) && $attributes[$field] !== null
                    ? (string) $attributes[$field]
                    : null;
            }

            return isset($row->{$field}) ? (string) $row->{$field} : null;
        };

        return self::fromParts(
            $get('profile_type'),
            $get('organization_name'),
            $get('first_name'),
            $get('last_name'),
            $get('name'),
            $fallback,
        );
    }

    /**
     * Resolve a display name from individual parts.
     *
     * Precedence, and the reason for it:
     *  1. the organisation name, when this is an organisation account;
     *  2. the stored `users.name`, when non-empty — a select that fetched only
     *     `name` (there are many) must keep the full name it already has rather
     *     than degrade to a lone first name;
     *  3. first + last name;
     *  4. the caller's fallback.
     */
    public static function fromParts(
        ?string $profileType,
        ?string $organizationName,
        ?string $firstName,
        ?string $lastName,
        ?string $storedName = null,
        ?string $fallback = null,
    ): string {
        $organisation = trim((string) $organizationName);
        if ($profileType === self::ORGANISATION && $organisation !== '') {
            return $organisation;
        }

        $stored = trim((string) $storedName);
        if ($stored !== '') {
            return $stored;
        }

        $person = trim(trim((string) $firstName) . ' ' . trim((string) $lastName));
        if ($person !== '') {
            return $person;
        }

        return (string) $fallback;
    }

    /**
     * The value to persist into `users.name`.
     *
     * Deliberately ignores any existing stored value: this is what the column
     * SHOULD hold given the current name fields, so it is safe to call on both
     * insert and update.
     */
    public static function forStorage(
        ?string $profileType,
        ?string $organizationName,
        ?string $firstName,
        ?string $lastName,
    ): string {
        return self::fromParts($profileType, $organizationName, $firstName, $lastName, null, '');
    }

    /** True when this row represents an organisation account with a usable name. */
    public static function isOrganisation(array|object|null $user): bool
    {
        if ($user === null) {
            return false;
        }

        if (is_array($user)) {
            $type = $user['profile_type'] ?? null;
            $name = $user['organization_name'] ?? null;
        } elseif ($user instanceof \Illuminate\Database\Eloquent\Model) {
            $attributes = $user->getAttributes();
            $type = $attributes['profile_type'] ?? null;
            $name = $attributes['organization_name'] ?? null;
        } else {
            $type = $user->profile_type ?? null;
            $name = $user->organization_name ?? null;
        }

        return $type === self::ORGANISATION && trim((string) $name) !== '';
    }

    /**
     * Initials for an avatar fallback.
     *
     * An organisation gets the initials of its own name, not the contact's.
     */
    public static function initials(array|object|null $user): string
    {
        $name = self::resolve($user);
        $words = preg_split('/\s+/u', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        if ($words === []) {
            return '';
        }

        $first = mb_substr($words[0], 0, 1);
        $second = count($words) > 1 ? mb_substr($words[count($words) - 1], 0, 1) : '';

        return mb_strtoupper($first . $second);
    }
}
